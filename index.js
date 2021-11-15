const { Client, Intents, MessageEmbed } = require('discord.js');
const config = require('./config.json');
const { dlog, bulkDLog, isIP } = require('./api');

const DISCORD_BOT_TOKEN = config.discord.botToken,
  client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

const MAX_PER_EMBED_CHECK = 30;
const MAX_PER_EMBED_WIKIS = 50;

client.login(DISCORD_BOT_TOKEN);

client.once('ready', () => {
  console.log(`Logged in to Discord.`);
});

const actions = {
  '!wikis': wikis,
  '!lookup': wikis,
  '!check': check,
  '!ping': pong,
  '!gdmhelp': help,
};

function cleanUser(user) {
  // Trim whitespaces and new lines
  user = user.replace(/^[\s\n]+|[\s\n]+$/g, '');
  user = user.replace(/^<|>$/g, '');
  // Clean up links
  user = user.replace(/^https?:\/\//g, '');
  user = user.replace(/^.*\.(wikia|fandom|gamepedia)\.(com|org|io)\/(wiki\/)?/g, '');
  user = user.replace(/^(User:|Special:Contributions\/|Special:Contribs\/)/g, '');
  // Replace spaces
  user = user.replace(/(%20|_)/g, ' ');
  // Uppercase first letter of the username
  user = user.charAt(0).toUpperCase() + user.slice(1);
  return user;
}

const getWikis = (logs) => {
  const wikis = logs.map((log) => log.siteName);
  return Array.from(new Set(wikis));
};

const getIPs = (logs) => {
  const ips = logs.map((log) => log.ip);
  return Array.from(new Set(ips));
};

const getUsers = (logs) => {
  const users = logs.map((log) => log.userName);
  return Array.from(new Set(users));
};

const getUsersOnWiki = (logs, wiki) => {
  const users = logs
    .filter((log) => log.siteName === wiki)
    .map((log) => log.userName);
  return Array.from(new Set(users));
};

async function wikis(msg) {
  let parts = msg.content.split(' ');
  parts.shift();
  let username = parts.join(' ');
  username = cleanUser(username);

  if (isIP(username)) {
    msg.channel.send('Cannot lookup the wikis for an IP.');
    return;
  }
  msg.channel.sendTyping();

  const logs = await bulkDLog(
    username,
    null,
    () => {
      msg.channel.send('Loading logs... please wait! User has lots of activity!');
      msg.channel.sendTyping();
    },
    8,
  );
  if (logs.error) {
    if (logs.error.startsWith('Valid')) {
      msg.channel.send('Invalid username provided. Please check again!');
    } else {
      msg.channel.send(logs.error);
    }
    return;
  }

  const wikis = getWikis(logs);
  const userId = logs.find((log) => log.userId !== '' && log.userId != null)?.userId || '';

  const wikiStrings = wikis.map((wiki) => {
    return `• [${wiki}](https://${wiki}/f/u/${userId})`;
  });

  if (logs.length === 0 || wikis.length === 0) {
    msg.channel.send('No wikis found for ' + username + '.');
  } else {
    if (wikiStrings.length > MAX_PER_EMBED_WIKIS) {
      for (let i = 0; i < wikiStrings.length / MAX_PER_EMBED_WIKIS; i++) {
        const embed = new MessageEmbed()
          .setTitle(`${username}: Discussions activity (${i + 1}/${Math.ceil(wikiStrings.length / MAX_PER_EMBED_WIKIS)})`)
          .setDescription(wikiStrings.slice(i * MAX_PER_EMBED_WIKIS, (i + 1) * MAX_PER_EMBED_WIKIS).join('\n'))
          .setFooter(`Includes likes, upvotes and other activity. Earliest logs at ${logs[logs.length - 1].timestamp}.`);
        msg.channel.send({ embeds: [embed] }, { split: true });
      }
    } else {
      const embed = new MessageEmbed()
        .setTitle(`${username}: Discussions activity`)
        .setDescription(wikiStrings.join('\n'))
        .setFooter(`Includes likes, upvotes and other activity. Earliest logs at ${logs[logs.length - 1].timestamp}.`);
      msg.channel.send({ embeds: [embed] }, { split: true });
    }
  }
}

async function check(msg, wiki) {
  let parts = msg.content.split(' ');
  parts.shift();
  let username = parts.join(' ');
  username = cleanUser(username);

  msg.channel.sendTyping();

  const userLogs = await bulkDLog(
    username,
    null,
    () => msg.channel.send('Loading logs... please wait! User has lots of activity!'),
    8,
  );
  if (userLogs.error) {
    if (userLogs.error.startsWith('Valid')) {
      msg.channel.send('Invalid username provided. Please check again!');
    } else {
      msg.channel.send(userLogs.error);
    }
    return;
  }
  if (userLogs.length === 0) {
    msg.channel.send('No results found for ' + username + '.');
    return;
  }

  const ips = getIPs(userLogs);
  const promises = ips.filter((ip) => ip !== '').map((ip) => bulkDLog(ip));
  const ipChecks = await Promise.allSettled(promises);
  const accounts = ipChecks.map((res) => {
    if (wiki) {
      return getUsersOnWiki(res.value || [], wiki);
    }
    return getUsers(res.value || []);
  });
  const allIPLogs = Array.from(new Set([].concat.apply([], ipChecks.map(res => res.value || []))));
  const allUsers = Array.from(new Set([].concat.apply([], accounts))).filter(user => user !== username);

  if (allUsers.length === 0) {
    msg.channel.send(`No other accounts found for ${username}.`);
    return;
  }

  // user agents - e.g. browsers, etc.
  let userAgents = Array.from(new Set(userLogs.map((log) => {
    return log.userAgent;
  }))).filter((userAgent) => {
    return userAgent != null;
  });
  // app IDs - e.g. fandom app device ID
  let userAppIds = Array.from(new Set(userLogs.map((log) => {
    return log.appId;
  }))).filter((appId) => {
    return appId !== '' && appId !== 'opted-out';
  });

  // Map of user to flag
  const userToFlagMap = {};
  const userToLogMap = {};
  allIPLogs.forEach(log => {
    if (log.userName === username) {
      // do nothing
    } else if (userAppIds.indexOf(log.appId) >= 0) {
      userToFlagMap[log.userName] = ':exclamation: App ID match';
    } else if (userAgents.indexOf(log.userAgent) >= 0) {
      userToFlagMap[log.userName] = ':grey_exclamation: Device/browser match';
    }
    if (!userToLogMap[log.userName]) {
      userToLogMap[log.userName] = log;
    }
  });

  const userStrings = allUsers.map(user => {
    let { siteName, userId } = userToLogMap[user];
    if (siteName === '') {
      siteName = 'community.fandom.com';
    }
    const flag = userToFlagMap[user];
    return `• ${user} [${siteName}](https://${siteName}/f/u/${userId}) ${flag ? `${flag}` : ''}`;
  });

  if (userStrings.length > MAX_PER_EMBED_CHECK) {
    for (let i = 0; i < userStrings.length / MAX_PER_EMBED_CHECK; i++) {
      const embed = new MessageEmbed()
        .setTitle(`${username}: Discussions activity (${i + 1}/${Math.ceil(userStrings.length / MAX_PER_EMBED_CHECK)})`)
        .setDescription(userStrings.slice(i * MAX_PER_EMBED_CHECK, (i + 1) * MAX_PER_EMBED_CHECK).join('\n'))
        .setFooter(`Includes likes, upvotes and other activity. Earliest logs at ${userLogs[userLogs.length - 1].timestamp}. Note that device/browser match may not mean they are the same user.`);
      msg.channel.send({ embeds: [embed] }, { split: true });
    }
  } else {
    const embed = new MessageEmbed()
      .setTitle(`${username}: Discussions activity`)
      .setDescription(userStrings.join('\n'))
      .setFooter(`Includes likes, upvotes and other activity. Earliest logs at ${userLogs[userLogs.length - 1].timestamp}. Note that device/browser match may not mean they are the same user.`);
    msg.channel.send({ embeds: [embed] }, { split: true });
  }
}

async function pong(msg) {
  msg.channel.send('Pong.');
}

async function help(msg) {
  msg.channel.send(
    '`!wikis <user>`: Lists wikis where the user has Discussions posts, replies, upvotes, deletes, locks. \n' +
    '`!check <user>`: Lists alternate accounts (shares the same IPs) based on Discussions activity. \n' +
    '`!ping`: Check if this bot is alive. \n' +
    '`!gdmhelp`: Shows this list of commands. \n' +
    'Work in progress: planning to reduce !wikis to just posts and replies.',
  );
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  let allowedChannelIds = [
    // '741183214386937926', // noreply
    '741224570987479060', // gdm
    '752725171269533829', // xiphos!
  ];
  let singleWikiAllowedChannelIds = [
    '766444966259851275',
    '741183214386937926',
  ];
  let singleWikiConfig = {
    '766444966259851275': {
      wiki: 'community.fandom.com',
    },
    '741183214386937926': {
      wiki: 'community.fandom.com',
    },
  };
  let singleWikiAllowedActions = ['!check', '!ping', '!gdmhelp'];

  if (allowedChannelIds.indexOf(message.channel.id) >= 0) {
    for (const action in actions) {
      if (message.content.startsWith(action)) {
        try {
          await actions[action](message);
        } catch (e) {
          message.channel.send(`An error occurred. <@65018842702688256>\n${e}`);
          console.error('An error occurred for GDM Lookup Bot', e);
        }
      }
    }
  }
  if (singleWikiAllowedChannelIds.indexOf(message.channel.id) >= 0) {
    for (const action in actions) {
      if (singleWikiAllowedActions.includes(action)) {
        if (message.content.startsWith(action)) {
          actions[action](message, singleWikiConfig[message.channel.id].wiki);
        }
      }
    }
  }
});
