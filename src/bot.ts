import * as telegraf from "telegraf";
import { Config } from "./config";
let config: Config = require('../config.json');
import { Search } from './search';
import * as HttpsProxyAgent from 'https-proxy-agent';

const Telegraf = <telegraf.TelegrafConstructor>require('telegraf');


const bot = new Telegraf(config.telegram.botToken, {
    telegram: {
        agent: config.telegram.proxyUrl ? new HttpsProxyAgent(config.telegram.proxyUrl) : null
    }
});
const search = new Search();

bot.telegram.getMe().then((botInfo) => {
    bot.options.username = botInfo.username;
    console.log("Initialized", bot.options.username);
});

bot.start(async (ctx) => {
    ctx.reply("Welcome to " + bot.options.username);
});

bot.on('sticker', async (ctx) => {
    console.log(ctx.message.sticker);
    // console.log(await ctx.telegram.getStickerSet(ctx.message.sticker.set_name));
    ctx.reply(JSON.stringify(ctx.message.sticker, null, 4));
    search.addSticker(ctx.message.sticker);
    // ctx.message.sticker
});

bot.startPolling();