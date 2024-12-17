const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const P = require('pino'); // Pino logger for silent mode
const qrcode = require('qrcode'); // Required to generate the QR code image

// Directory path for saving credentials
const authDirectory = path.join(__dirname, 'auth_info_baileys/');
const qrCodeImagePath = path.join(__dirname, 'qr_code.png'); // Path where the QR code image will be saved
const configPath = path.join(__dirname, 'config.json'); // Path for configuration file

let activeChats = new Set();
let lastId = null;

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
    const caption = `*${title}*\n\n${text}\n\nRead more: [News Link](${newsURL})\n\n_Powered by Bitx ❤️_`;

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
    return { activeJids: [] }; // Default value
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

    // Get the credentials state from the multi-file auth state
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);

    if (state) {
        console.log('Credentials found. Skipping QR code generation and connecting directly...');
    }

    // Fetch the latest Baileys version
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        logger: P({ level: 'silent' }), // Set logger to silent mode
        printQRInTerminal: false, // Disable the built-in QR code print in terminal
        browser: Browsers.macOS("Firefox"), // Define browser settings for the WhatsApp connection
        syncFullHistory: false, // Synchronize full chat history
        auth: state || {}, // Use the authentication state if available
        version // Use the latest Baileys version
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
        } else if (qr) {
            // Only generate and show QR code if no credentials are found
            if (!state) {
                console.log('Generating QR code...');
                try {
                    await qrcode.toFile(qrCodeImagePath, qr); // Save QR code as an image file
                    console.log(`QR code saved as image at ${qrCodeImagePath}`);
                } catch (error) {
                    console.error('Error generating QR code image:', error);
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message.message) return;

        const jid = message.key.remoteJid;
        const text = message.message.conversation || message.message.extendedTextMessage?.text;

        if (text === '.active') {
            // Mark the chat as active
            const config = await loadConfig();
            if (!config.activeJids.includes(jid)) {
                config.activeJids.push(jid); // Add group JID to active chats
                await saveConfig(config);
                activeChats.add(jid);
                await sock.sendMessage(jid, { text: 'News bot is now active for this chat.' });
            }
        }
    });

    async function checkForUpdates() {
        const newsData = await fetchNewsData();
        if (!newsData) return;

        if (newsData.id !== lastId) {
            lastId = newsData.id;
            for (const chat of activeChats) {
                await sendNews(sock, chat, newsData);
            }
        }
    }

    setInterval(checkForUpdates, 20000); // Check every 20 seconds

    // Send dynamic news from API as test news to active chats
    async function sendTestNews() {
        const newsData = await fetchNewsData(); // Fetch news dynamically
        if (newsData) {
            for (const chat of activeChats) {
                await sendNews(sock, chat, newsData);
            }
        }
    }

    // Send test news to active chats every minute (for testing purposes)
    setInterval(sendTestNews, 60000); // Every 60 seconds (1 minute)
}

connectToWA();
