import { TelegrafConstructor, Extra, Markup, CallbackButton } from "telegraf";
import { Config } from "./config";
let config: Config = require('../config.json');
import { Search } from './search';
import * as HttpsProxyAgent from 'https-proxy-agent';
import { ExtraEditMessage } from "telegraf/typings/telegram-types";

const Telegraf = <TelegrafConstructor>require('telegraf');


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

let generateTaggingInline = async (stickerId: string): Promise<ExtraEditMessage> => {
    let tags = await search.getStickerTags(stickerId);
    let isNsfw = tags.indexOf('nsfw') > 0;
    let isFurry = tags.indexOf('furry') > 0;
    tags = tags.filter(t => t != 'furry' && t != 'nsfw');
    let inlineButtons = [[]];
    inlineButtons[0].push(Markup.callbackButton('Furry: ' + isFurry ? '✅' : '❌', 'toggle_tag furry ' + stickerId));
    inlineButtons[0].push(Markup.callbackButton('NSFW: ' + isNsfw ? '✅' : '❌', 'toggle_tag nsfw ' + stickerId));

    let tmp = [];
    let tagsPerLine = 3;
    let idx = 0;
    tags.forEach((tag, i) => {
        if (i % tagsPerLine == 0) {
            inlineButtons.push(tmp);
            tmp = [];
        }
        // TODO: show a X only for removable tags
        tmp.push(Markup.callbackButton(tag, 'remove_tag ' + tag + ' ' + stickerId));
    });
    if (tmp.length > 0) {
        inlineButtons.push(tmp);
    }

    return Extra.HTML().markup(Markup.inlineKeyboard(inlineButtons));
}

bot.on('sticker', async (ctx) => {
    let stickerId = ctx.message.sticker.file_id;
    console.log("received sticker", stickerId);

    // console.log(await ctx.telegram.getStickerSet(ctx.message.sticker.set_name));
    // ctx.reply(JSON.stringify(ctx.message.sticker, null, 4));

    let msg = '';
    if (! await search.stickerExists(stickerId)) {
        msg += `New untagged sticker found. Let's add some tags now.`;
        await search.addSticker(ctx.message.sticker);
    } else {
        msg += `Current tags:`;
        console.log(await search.getStickerTags(stickerId));
    }

    ctx.reply(msg, await generateTaggingInline(stickerId));

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

bot.on('callback_query', async (ctx) => {
    let args = ctx.callbackQuery.data.split(' '); // splits command (eg. 'remove_tag asdf 1241512')
    switch (args[0]) {
        case 'toggle_tag':
            search.toggleTag(args[2], args[1]);
            break;
        case 'remove_tag':
            // TODO: check if authorized to remove
            search.removeTag(args[2], args[1]);
            break;
    }
    console.log('received callback query:', ctx.callbackQuery);
});

bot.startPolling();