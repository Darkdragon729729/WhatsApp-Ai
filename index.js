const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Global counter to track which API key to use next
let currentKeyIndex = 0;

// 1. Webhook Verification Route for Meta
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
});

// 2. Incoming Messages Route
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
        if (
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0].value.messages &&
            body.entry[0].changes[0].value.messages[0]
        ) {
            const message = body.entry[0].changes[0].value.messages[0];
            const from = message.from; 
            const msgBody = message.text ? message.text.body : null;

            if (msgBody) {
                console.log(`Received message from ${from}: ${msgBody}`);

                // Fetch AI response using the multi-key rotating mechanism
                const aiResponse = await getGeminiResponse(msgBody);

                // Send the response back to the user
                await sendWhatsAppMessage(from, aiResponse);
            }
        }
        return res.sendStatus(200);
    } else {
        return res.sendStatus(404);
    }
});

// Advanced Function to rotate and test Gemini API Keys automatically
async function getGeminiResponse(userPrompt) {
    // Create an array of your keys and remove any empty slots
    const geminiKeys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3
    ].filter(Boolean);

    if (geminiKeys.length === 0) {
        console.error("Error: No Gemini API keys found in your .env configuration file.");
        return "Configuration error. Please check the server environment variables.";
    }

    // Loop through the keys array. If a key hits a limit, it jumps straight to the next one.
    for (let attempts = 0; attempts < geminiKeys.length; attempts++) {
        const apiKey = geminiKeys[currentKeyIndex];
        
        // Log exactly which key pointer is active
        console.log(`Using Gemini Key Index Slot: ${currentKeyIndex + 1}`);

        // Shift the index position for the NEXT message request
        currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

            const response = await axios.post(url, {
                contents: [{
                    parts: [{ text: userPrompt }]
                }]
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000 // 10 seconds timeout limit
            });

            // If successful, extract text and send it out immediately
            const aiText = response.data.candidates[0].content.parts[0].text;
            return aiText;

        } catch (error) {
            console.warn(`Gemini Key Slot ${currentKeyIndex === 0 ? geminiKeys.length : currentKeyIndex} failed or rate limited. Trying next available slot...`);
            // The loop naturally carries on to test the next active key index
        }
    }

    // Reaching this point means all 3 keys hit their limits at the exact same time
    return "The system is currently handling too many requests. Please try sending your message again in a minute.";
}

// Function to send WhatsApp Message via Meta API
async function sendWhatsAppMessage(toPhoneNumber, textMessage) {
    try {
        const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;
        
        await axios.post(url, {
            messaging_product: "whatsapp",
            to: toPhoneNumber,
            type: "text",
            text: { body: textMessage }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Message successfully sent to ${toPhoneNumber}`);
    } catch (error) {
        console.error("Meta WhatsApp API Error:", error.response ? error.response.data : error.message);
    }
}

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});
