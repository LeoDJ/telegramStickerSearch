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

bot.command('start', async (ctx) => {
    // TODO fix group parsing (/start@BotName)

    let args = ctx.message.text.split(' ');
    let cameFromInline: boolean = args[1] == 'fromInline';

    if (! await search.userExists(ctx.from.id)) {
        // register new user and send welcome message
        console.log("New User:", ctx.from.username || ctx.from.first_name);
        search.registerUser(ctx.from);
        ctx.reply("Welcome to " + bot.options.username);

    } else {
        // TODO reset user state
        search.initUser(ctx.from.id);
    }

});

bot.on('sticker', async (ctx) => {
    console.log("received sticker", ctx.message.sticker);
    // console.log(await ctx.telegram.getStickerSet(ctx.message.sticker.set_name));
    ctx.reply(JSON.stringify(ctx.message.sticker, null, 4));
    search.addSticker(ctx.message.sticker);
    // ctx.message.sticker
});

bot.on('inline_query', async (ctx) => {
    let cid = ctx.from.id;
    let query = ctx.inlineQuery.query;
    if (await search.userExists(cid)) {
        // search foo
        let results = await search.searchSticker(query, cid, +ctx.inlineQuery.offset);
        return ctx.answerInlineQuery(
            results,
            {
                cache_time: 5,
                is_personal: true,
                // only provide next offset, when there are (probably) more data to query (TODO: check actual ES query result count here)
                next_offset: (results.length == 50) ? (ctx.inlineQuery.offset + 50) : "" 
            }
        );
    } else {
        // show register prompt
        return ctx.answerInlineQuery(
            [],
            {
                cache_time: 1,
                switch_pm_text: "Click here to begin using the bot",
                switch_pm_parameter: "fromInline"
            }
        );
    }
    console.log(cid, query);
});

bot.on('chosen_inline_result', async (ctx) => {
    console.log("chosen inline result", ctx.chosenInlineResult);
});

bot.startPolling();