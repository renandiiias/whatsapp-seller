import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import axios from 'axios';
import qrcode from 'qrcode-terminal';
import qr from 'qr-image';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
    }
});

// OpenRouter API configuration
const OPENROUTER_API_KEY = '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';
const ALLOWED_PHONE = '5517997811178'; // The number that will receive responses (without + and spaces)

// Initialize WhatsApp client
client.initialize();

// Initialize database connection
let db;
(async () => {
    db = await open({
        filename: './instructions.db',
        driver: sqlite3.Database
    });
    await db.exec('CREATE TABLE IF NOT EXISTS instructions (prompt TEXT, instruction TEXT)');
})();

// Generate response using OpenRouter API
async function generateResponse(message) {
    try {
        // First try to find an exact prompt match
        const query = `SELECT prompt, instruction FROM instructions WHERE prompt = ?`;
        const matchingInstruction = await db.get(query, [message]);
        
        if (!matchingInstruction) {
            // If no exact match, try to find a partial match
            const partialQuery = `SELECT prompt, instruction FROM instructions WHERE ? LIKE '%' || prompt || '%'`;
            const partialMatch = await db.get(partialQuery, [message]);
            if (partialMatch) {
                return generateResponseWithInstruction(message, partialMatch.instruction, partialMatch.prompt);
            }
            return generateResponseWithInstruction(message, null, null);
        }
        
        return generateResponseWithInstruction(message, matchingInstruction.instruction, matchingInstruction.prompt);
    } catch (error) {
        console.error('Error finding instruction:', error);
        return generateResponseWithInstruction(message, null, null);
    }
}

async function generateResponseWithInstruction(message, instruction, matchedPrompt) {
    try {
        const modifiedMessage = instruction ? 
            `[Matched Prompt: "${matchedPrompt}"]
             [Instruction: ${instruction}]
             User Message: ${message}` : message;

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: "google/gemini-pro",
            messages: [
                {
                    role: "user",
                    content: modifiedMessage
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:8000',
                'X-Title': 'WhatsApp Bot',
                'OpenRouter-Model-Preference': 'google/gemini-pro'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error generating response:', error.response?.data || error.message || error);
        return `Error: ${error.response?.data?.error?.message || error.message || 'Unknown error occurred'}`;
    }
}

// QR Code event
client.on('qr', (qrCode) => {
    console.log('QR Code received. Generating image...');
    qrcode.generate(qrCode, { small: true });
    const qr_png = qr.image(qrCode, { type: 'png' });
    qr_png.pipe(fs.createWriteStream('qr_code.png'));
    console.log('QR Code saved as qr_code.png. Open the image to scan.');
    console.log('Scan the QR Code above with WhatsApp to log in');
});

// Ready event
client.on('ready', () => {
    console.log('WhatsApp client is ready and connected!');
    console.log('Bot will respond to messages from: +' + ALLOWED_PHONE);
});

// Message event
client.on('message', async msg => {
    // Extract the phone number without the @c.us suffix
    const phone = msg.from.split('@')[0];
    
    // Log the sender's phone number
    console.log('Received message from:', phone);

    // Only respond to messages from the allowed phone number
    if (phone === ALLOWED_PHONE) {
        console.log('Processing message from allowed number:', msg.body);
        
        try {
            // Generate response
            const response = await generateResponse(msg.body);
            
            // Send response
            await msg.reply(response);
            console.log('Response sent successfully');
        } catch (error) {
            console.error('Error handling message:', error);
            await msg.reply('Sorry, I encountered an error while processing your message.');
        }
    } else {
        console.log('Message from unauthorized number:', phone);
    }
});

// Error handling
client.on('auth_failure', msg => {
    console.error('Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Client was disconnected:', reason);
});

process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await client.destroy();
    process.exit();
});
