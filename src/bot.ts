import { TelegrafConstructor, Extra, Markup, CallbackButton } from "telegraf";
import { Config } from "./config";
let config: Config = require('../config.json');
import { Search } from './search';
import * as HttpsProxyAgent from 'https-proxy-agent';
import { ExtraEditMessage } from "telegraf/typings/telegram-types";
import { UserState } from "./models/UserState";
import { emojiStringToArray, emojiToUnicode, emojiToUnicodeRaw } from "./emoji";

const Telegraf = <TelegrafConstructor>require('telegraf');


const bot = new Telegraf(config.telegram.botToken, {
    telegram: {
        agent: config.telegram.proxyUrl ? new HttpsProxyAgent(config.telegram.proxyUrl) : null
    }
});
const search = new Search();

const stickerTaggingMessage = `To add new tags, simply type them separated by commas or spaces. 
Use underscores for tags_containging_spaces (30 chars max). 
Click to toggle flag or remove a wrong tag.`

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

async function generateTaggingInline(stickerId: string, tags?: string[]): Promise<ExtraEditMessage> {
    if (tags == undefined) {
        tags = await search.getStickerTags(stickerId) || [];
    }
    let isNsfw = tags.indexOf('nsfw') > -1;
    let isFurry = tags.indexOf('furry') > -1;
    tags = tags.filter(t => t != 'furry' && t != 'nsfw');
    let inlineButtons = [[]];
    inlineButtons[0].push(Markup.callbackButton('Furry: ' + (isFurry ? '✅' : '❌'), '^ furry ' + stickerId));
    inlineButtons[0].push(Markup.callbackButton('NSFW: ' + (isNsfw ? '✅' : '❌'), '^ nsfw ' + stickerId));

    let tmp = [];
    let tagsPerLine = 3;
    let idx = 0;
    tags.forEach((tag, i) => {
        if (i % tagsPerLine == 0) {
            inlineButtons.push(tmp);
            tmp = [];
        }
        // TODO: show a X only for removable tags
        tmp.push(Markup.callbackButton(tag, '- ' + tag + ' ' + stickerId));
    });
    if (tmp.length > 0) {
        inlineButtons.push(tmp);
    }

    return Extra.HTML().markup(Markup.inlineKeyboard(inlineButtons));
}

bot.on('sticker', async (ctx) => {
    let sticker = ctx.message.sticker;
    let stickerId = sticker.file_id;
    console.log("received sticker", stickerId);

    // console.log(await ctx.telegram.getStickerSet(ctx.message.sticker.set_name));
    // ctx.reply(JSON.stringify(ctx.message.sticker, null, 4));

    if(! await search.stickerSetExists(sticker.set_name)) {
        let stickerSet = await ctx.telegram.getStickerSet(sticker.set_name);
        search.addStickerSet(stickerSet, ctx.chat.id);
        
        // index all stickers of pack
        stickerSet.stickers.forEach(async (sticker, i) => {
            await search.addSticker(sticker, ctx.chat.id, i);
        });

        // TODO: set tagging logic and afterward switching to single sticker tagging

    }
    else {
        let msg = '';
        if (! await search.stickerExists(stickerId)) {
            msg += `New untagged sticker found. Let's add some tags now.\n\n` + stickerTaggingMessage;
            await search.addSticker(ctx.message.sticker, ctx.chat.id);
        } else {
            msg += stickerTaggingMessage;
            console.log(await search.getStickerTags(stickerId));
        }
    
        let extra: ExtraEditMessage  = await generateTaggingInline(stickerId);
        extra.reply_to_message_id = ctx.message.message_id;
        let reply = await ctx.reply(msg, extra);
        search.setUserState(ctx.chat.id, UserState.TaggingSticker, {stickerId: stickerId, messageId: reply.message_id});
        // TODO: save message id for updating
    }
});

// have to delay, because Elasticsearch is not instant updating
// TODO: make it instant updating (implementing other generateTaggingInline, without direct DB query)
async function updateTaggingMessage(chatId: number, messageId: number, stickerId: string, tags?: string[], text?: string) {
    return new Promise(resolve => {
        setTimeout(async () => {
            try {
                await bot.telegram.editMessageText(
                    chatId,
                    messageId, 
                    undefined, 
                    text || stickerTaggingMessage, 
                    await generateTaggingInline(stickerId, tags));
            }
            catch (err) {
                // don't print bad request errors, that happen when message is updated with same content
                if(err.code != 400) {
                    console.log(err);
                } 
            }
            resolve();
        }, (tags == undefined) ? 1500 : 0); 
    });
}

async function handleTaggingInput(input: string, stickerId: string) {
    input.replace('/tag', '');
    let tags = input.split(/[, ]+/);
    tags = tags.map(t => t.substring(0, 30)); // max 64 chars for callback data (31 for sticker id, 3 for control = 30 for tag name)
    // console.log(tags);
    return await search.addTags(stickerId, tags);
}

// handle incoming messages that are not commands
bot.on('message', async (ctx) => {
    let cid = ctx.chat.id;

    let state = await search.getUserState(cid);
    switch(state.userState) {
        case UserState.TaggingSticker:
            let result = await handleTaggingInput(ctx.message.text, state.userStateData.stickerId);
            updateTaggingMessage(cid, state.userStateData.messageId, state.userStateData.stickerId, result.body.get._source.tags);
        break;
    }
});

// process inline search result
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
        // show register prompt, if user hasn't registered yet
        return ctx.answerInlineQuery(
            [],
            {
                cache_time: 1,
                switch_pm_text: "Click here to begin using the bot",
                switch_pm_parameter: "fromInline"
            }
        );
    }
});

// generate statistics based on stickers that get sent via the inline bot (so most used stickers stand at the beginning)
bot.on('chosen_inline_result', async (ctx) => {
    // TODO: save sticker usage for promoting often used stickers
    console.log("chosen inline result", ctx.chosenInlineResult);
});

// process responses from inline buttons in chat (tagging interface)
bot.on('callback_query', async (ctx) => {
    let args = ctx.callbackQuery.data.split(' '); // splits command (eg. 'remove_tag asdf 1241512')
    let cmd = args[0], tag = args[1], stickerId = args[2];
    let cbMsg = '';
    let result;
    switch (cmd) {
        case '^':
            result = await search.toggleTag(stickerId, tag);
            cbMsg = `Toggled flag '${tag}'`;
            break;
        case '-':
            // TODO: check if authorized to remove
            result = await search.removeTag(stickerId, tag);
            cbMsg = `Removed tag '${tag}'`;
            break;
    }

    if (result) {
        await updateTaggingMessage(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id, stickerId, result.body.get._source.tags);
        ctx.answerCbQuery(cbMsg);
    }
    
    // console.log('received callback query:', ctx.callbackQuery);
    // console.log('CTX', ctx.message);
});

bot.startPolling();