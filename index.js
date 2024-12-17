const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const P = require('pino');
const qrcode = require('qrcode');
const express = require('express');

const authDirectory = path.join(__dirname, 'auth_info_baileys/');
const qrCodeImagePath = path.join(__dirname, 'qr_code.png');
const configPath = path.join(__dirname, 'config.json');

let activeChats = new Set();
let lastId = null;
let latestNews = null; // Store the latest fetched news

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/qr', (req, res) => {
    res.sendFile(qrCodeImagePath);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

async function fetchNewsData() {
    try {
        const response = await axios.get('https://bit-x-apis.vercel.app/hiru');
        return response.data;
    } catch (error) {
        console.error('Error fetching news data:', error);
        return null;
    }
}

async function sendNews(sock, jid, news) {
    const { title, text, image, newsURL } = news;
    const caption = `*${title}*\n\n${text}\n\nRead more: [News Link](${newsURL})\n\n> 𝗕𝘆 𝗕𝗜𝗧 𝗫 😎`;

    await sock.sendMessage(jid, {
        image: { url: image },
        caption,
    });
}

async function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath);
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
    return { activeJids: [] };
}

async function saveConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

async function connectToWA() {
    console.log("Connecting to WhatsApp bot 🕦...");

    const credsExist = fs.existsSync(path.join(authDirectory, 'creds.json'));
    
    if (credsExist) {
        console.log('Credentials found. Connecting directly...');
    } else {
        console.log('No credentials found. Generating QR code...');
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS("Firefox"),
        syncFullHistory: false,
        auth: state || {},
        version
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('Reconnecting...');
                connectToWA();
            }
        } else if (connection === 'open') {
            console.log('Connected to WhatsApp');
        } else if (qr && !credsExist) {
            try {
                await qrcode.toFile(qrCodeImagePath, qr);
                console.log(`QR code saved as image at ${qrCodeImagePath}`);
            } catch (error) {
                console.error('Error generating QR code image:', error);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message.message) return;

        const jid = message.key.remoteJid;
        const text = message.message.conversation || message.message.extendedTextMessage?.text;

        if (text === '.active') {
            const config = await loadConfig();
            if (!config.activeJids.includes(jid)) {
                config.activeJids.push(jid);
                await saveConfig(config);
                activeChats.add(jid);
                await sock.sendMessage(jid, { text: 'News bot is now active for this chat.' });

                // Send the latest news immediately after becoming active
                await sendTestNews(sock);
            }
        }
    });

    async function checkForUpdates() {
        const newsData = await fetchNewsData();
        if (!newsData) return;

        if (newsData.id !== lastId) {
            lastId = newsData.id;
            latestNews = newsData; // Update the latest news
            for (const chat of activeChats) {
                await sendNews(sock, chat, newsData);
            }
        }
    }

    async function sendTestNews(sock) {
        const newsData = await fetchNewsData();
        if (newsData) {
            latestNews = newsData; // Store the fetched test news
            for (const chat of activeChats) {
                await sendNews(sock, chat, newsData);
            }
        }
    }

    setInterval(checkForUpdates, 20000); // Check for new news every 20 seconds
}

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});

connectToWA();
