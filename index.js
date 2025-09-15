require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const randomUseragent = require('random-useragent');

const email = process.env.EMAIL;
const password = process.env.PASSWORD;

async function fetchRefreshToken(email, password) {
    const payload = { user_id: email, password };
    try {
        const res = await axios.post(
            'https://task.titannet.io/api/auth/login',
            payload,
            { headers: { 'User-Agent': randomUseragent.getRandom(), 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        if (res.data?.code === 0) return res.data.data.refresh_token;
    } catch(e) { console.error(e.message); }
    return null;
}

class TitanNode {
    constructor(refreshToken) {
        this.refreshToken = refreshToken;
        this.deviceId = uuidv4();
        this.accessToken = null;
        this.api = axios.create({
            headers: {
                'Accept': '*/*',
                'Content-Type': 'application/json',
                'User-Agent': randomUseragent.getRandom()
            },
            timeout: 5000
        });
        this.ws = null;
        this.pingInterval = null;
    }

    async refreshAccessToken() {
        const res = await this.api.post('https://task.titannet.io/api/auth/refresh-token', { refresh_token: this.refreshToken });
        if (res.data?.code === 0) {
            this.accessToken = res.data.data.access_token;
            this.api.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
            return true;
        }
        return false;
    }

    async registerNode() {
        await this.api.post('https://task.titannet.io/api/webnodes/register', {
            ext_version: "0.0.4",
            language: "en",
            user_script_enabled: true,
            device_id: this.deviceId,
            install_time: new Date().toISOString(),
        });
    }

    connectWebSocket() {
        const wsUrl = `wss://task.titannet.io/api/public/webnodes/ws?token=${this.accessToken}&device_id=${this.deviceId}`;
        this.ws = new WebSocket(wsUrl, { headers: { 'User-Agent': this.api.defaults.headers['User-Agent'] } });

        this.ws.on('open', () => {
            console.log('WebSocket connected.');
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ cmd: 1, echo: "echo me", jobReport: { cfgcnt: 2, jobcnt: 0 } }));
                }
            }, 30000);
        });

        this.ws.on('message', data => {
            try {
                const msg = JSON.parse(data);
                if (msg.userDataUpdate) console.log(`Today: ${msg.userDataUpdate.today_points} | Total: ${msg.userDataUpdate.total_points}`);
            } catch(e){}
        });

        this.ws.on('close', () => clearInterval(this.pingInterval));
        this.ws.on('error', e => { console.error(e.message); try { this.ws.close() } catch{} });
    }

    async start() {
        const ok = await this.refreshAccessToken();
        if (!ok) return console.error("Failed refresh token");
        await this.registerNode();
        this.connectWebSocket();
    }
}

async function runBot() {
    const refreshToken = await fetchRefreshToken(email, password);
    if (!refreshToken) return console.error("Login failed");
    const bot = new TitanNode(refreshToken);
    await bot.start();
    console.log("Bot running...");
}

runBot();
