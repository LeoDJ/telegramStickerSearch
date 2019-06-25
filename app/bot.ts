import * as telegraf from "telegraf";
import { Config } from "./config";
let config: Config = require('../config.json');

const bot = new telegraf.Telegraf(config.telegram.botToken);

bot.telegram.getMe().then((botInfo) => {
    bot.options.username = botInfo.username;
    console.log("Initialized", botInfo.username);
});

bot.startPolling();