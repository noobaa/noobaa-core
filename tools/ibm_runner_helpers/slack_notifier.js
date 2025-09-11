/* Copyright (C) 2016 NooBaa */
'use strict';

const { IncomingWebhook } = require('@slack/webhook');
const fs = require('fs');

async function main() {
  const [,, webhookUrl, status, message] = process.argv;

  if (!webhookUrl) {
    process.exit(0);
  }

  try {
    const webhook = new IncomingWebhook(webhookUrl);
    const emoji = status === 'success' ? '✅' : '❌';
    const text = emoji + ' ' + message;

    // Read log file content
    let logContent = 'Log file not available';
    try {
      logContent = fs.readFileSync('/var/log/cloud-init-output.log', 'utf8');
    } catch (err) {
      console.error('Could not read log file:', err.message);
    }

    // Send message with log content as attachment
    await webhook.send({
      text: text,
      attachments: [{
        color: status === 'success' ? 'good' : 'danger',
        title: 'Cloud Init Output Log',
        text: '```' + logContent + '```',
        mrkdwn_in: ['text']
      }]
    });

  } catch (error) {
    console.error('Notification failed:', error.message);
  }

  process.exit(0);
}

main();
