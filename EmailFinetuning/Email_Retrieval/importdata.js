require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');
const readline = require('readline');

// OAuth 2.0 credentials from environment variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
const TOKEN_PATH = process.env.TOKEN_PATH || 'token.json';

// Message cap constant
const MESSAGE_CAP = 2500;

// Validate credentials before proceeding
if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('ERROR: Missing Google OAuth credentials!');
    console.error('Please ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in your .env file');
    process.exit(1);
}

// Create OAuth2 client
const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

console.log('Google OAuth Configuration:');
console.log('- Client ID:', CLIENT_ID.substring(0, 20) + '...');
console.log('- Redirect URI:', REDIRECT_URI);
console.log('- Token Path:', TOKEN_PATH);
console.log('');

/**
 * Get and store new token after prompting for user authorization.
 */
async function getNewToken() {
    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env file');
    }

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    });

    console.log('Authorize this app by visiting this url:', authUrl);
    console.log('After authorization, you will be redirected. Copy the code from the URL and paste it here.');

    // For command-line applications, prompt for the authorization code
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve, reject) => {
        rl.question('Enter the code from that page here: ', async (code) => {
            rl.close();
            try {
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                // Store the token to disk for later program executions
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                console.log('Token stored to', TOKEN_PATH);
                resolve(oAuth2Client);
            } catch (err) {
                console.error('Error while trying to retrieve access token', err);
                reject(err);
            }
        });
    });
}

/**
 * Load or request authorization credentials.
 */
async function authorize() {
    // Check if we have previously stored a token.
    let token;
    try {
        token = fs.readFileSync(TOKEN_PATH);
        const credentials = JSON.parse(token);
        oAuth2Client.setCredentials(credentials);

        // Check if token is expired or about to expire
        if (credentials.expiry_date && credentials.expiry_date < Date.now()) {
            console.log('Token expired, refreshing...');
            try {
                const { credentials: newCredentials } = await oAuth2Client.refreshAccessToken();
                oAuth2Client.setCredentials(newCredentials);
                // Save the new token
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(newCredentials));
                console.log('Token refreshed and saved');
            } catch (refreshErr) {
                console.error('Failed to refresh token:', refreshErr.message);
                console.log('Getting new token...');
                return await getNewToken();
            }
        }
    } catch (err) {
        // Token file doesn't exist or is invalid, get a new one
        return await getNewToken();
    }
    return oAuth2Client;
}

async function fetchGmailDataAndSaveToCSV() {
    // Authorize and create Gmail API client
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });

    // ---- Only change is adding 'labelIds: ["SENT"]' to restrict to sent messages ----
    async function fetchMessageIds() {
        let messages = [];
        let nextPageToken = null;

        do {
            try {
                const response = await gmail.users.messages.list({
                    userId: 'me',
                    labelIds: ['SENT'], // Only messages from Sent folder
                    maxResults: Math.min(100, MESSAGE_CAP - messages.length),
                    pageToken: nextPageToken,
                });

                if (response.data.messages) {
                    const newMessages = response.data.messages.slice(0, MESSAGE_CAP - messages.length);
                    messages = messages.concat(newMessages);
                }
                nextPageToken = (messages.length < MESSAGE_CAP) ? response.data.nextPageToken : null;
            } catch (err) {
                // Handle authentication errors
                if (err.code === 401 || err.code === 403) {
                    console.error('Authentication error:', err.message);
                    console.log('Please delete token.json and run the script again to re-authenticate');
                }
                console.error('Error fetching message IDs:', err.message);
                throw err;
            }
        } while (nextPageToken && messages.length < MESSAGE_CAP);

        return messages.map(msg => msg.id);
    }

    async function fetchMessage(messageId) {
        try {
            const response = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full',
            });
            return response.data;
        } catch (err) {
            // Handle authentication errors
            if (err.code === 401 || err.code === 403) {
                console.error('Authentication error:', err.message);
                console.log('Please delete token.json and run the script again to re-authenticate');
            }
            console.error(`Error fetching message ${messageId}:`, err.message);
            throw err;
        }
    }

    function extractSubject(headers) {
        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
        return subjectHeader ? subjectHeader.value : '';
    }

    function extractEmailBody(payload) {
        function getBody(part) {
            if (part.parts) {
                for (const subpart of part.parts) {
                    const body = getBody(subpart);
                    if (body) return body;
                }
            }
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                try {
                    return Buffer.from(part.body.data, 'base64').toString('utf-8');
                } catch (decodeErr) {
                    console.error(`Failed to decode email body:`, decodeErr);
                    return '';
                }
            }
            // Also try HTML if plain text is not available
            if (part.mimeType === 'text/html' && part.body && part.body.data) {
                try {
                    return Buffer.from(part.body.data, 'base64').toString('utf-8');
                } catch (decodeErr) {
                    console.error(`Failed to decode email body:`, decodeErr);
                    return '';
                }
            }
            return null;
        }
        return getBody(payload) || '';
    }

    let messageIds;
    try {
        console.log('Fetching message IDs from Sent folder...');
        messageIds = await fetchMessageIds();
        if (messageIds.length > MESSAGE_CAP) {
            messageIds = messageIds.slice(0, MESSAGE_CAP);
        }
        console.log(`Found ${messageIds.length} sent messages (capped at ${MESSAGE_CAP})`);
    } catch (err) {
        console.error('Failed to fetch message IDs:', err);
        throw err;
    }

    const result = [];
    const totalMessages = messageIds.length;

    for (let i = 0; i < messageIds.length; i++) {
        const messageId = messageIds[i];
        try {
            if ((i + 1) % 10 === 0) {
                console.log(`Processing message ${i + 1} of ${totalMessages}...`);
            }
            const msg = await fetchMessage(messageId);
            if (!msg.payload || !msg.payload.headers) {
                console.warn(`Message ${messageId} has missing payload or headers.`);
                continue;
            }
            const subject = extractSubject(msg.payload.headers);
            const body = extractEmailBody(msg.payload);
            result.push({ subject, body });
        } catch (err) {
            console.warn(`Failed to fetch or parse message ${messageId}: ${err.message}`);
        }
    }

    let csvContent = 'subject,body\n';
    for (const { subject, body } of result) {
        const csvSubject = '"' + subject.replace(/"/g, '""') + '"';
        const csvBody = '"' + body.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '') + '"';
        csvContent += `${csvSubject},${csvBody}\n`;
    }
    
    try {
        fs.writeFileSync('gmail_data.csv', csvContent, 'utf8');
        console.log(`Successfully saved ${result.length} sent emails to gmail_data.csv`);
    } catch (fileErr) {
        console.error('Failed to write gmail_data.csv:', fileErr);
        throw fileErr;
    }
    return result;
}

fetchGmailDataAndSaveToCSV()
    .then(() => console.log('Data saved to gmail_data.csv (only SENT emails included)'))
    .catch(err => {
        console.error('Error:', err);
        if (err && err.stack) {
            console.error('Stack Trace:', err.stack);
        }
        process.exit(1);
    });
