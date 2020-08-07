# gdm-lookup-bot

Lookup bot for Global Discussions Moderators on Fandom. Allows them access to DiscussionLog data without showing private user information.

Installation and startup:
```bash
npm install
pm2 start index.js --max-memory-restart 100M -n gdmlookup
``` 
