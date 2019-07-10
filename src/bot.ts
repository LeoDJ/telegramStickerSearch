import { TelegrafConstructor, Extra, Markup, CallbackButton } from "telegraf";
import { Config } from "./config";
let config: Config = require('../config.json');
import { Search } from './search';
import * as HttpsProxyAgent from 'https-proxy-agent';
import { ExtraEditMessage, InlineKeyboardMarkup, StickerSet } from "telegraf/typings/telegram-types";
import { UserState } from "./models/UserState";
import { emojiStringToArray, emojiToUnicode, emojiToUnicodeRaw } from "./emoji";

const Telegraf = <TelegrafConstructor>require('telegraf');


const bot = new Telegraf(config.telegram.botToken, {
    telegram: {
        agent: config.telegram.proxyUrl ? new HttpsProxyAgent(config.telegram.proxyUrl) : null
    }
});
const search = new Search();


function getPackTaggingMessage(title: string) {
    return `** Currently tagging sticker set ${title} **
  
Please categorize the complete set, if it contains only one Furry/NSFW you should still mark it as such.
You can also add set tags that apply to all stickers in the set. Note that the set name is already tagged.
`;
}

const stickerTaggingMessage = `To add new tags, simply type them separated by commas or spaces. 
Use underscores for tags\\_containing\\_spaces (30 chars max). 
Click to toggle flag or remove a wrong tag.`;

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

bot.command('done', async (ctx) => {
    doneTaggingSet(ctx.chat.id);
})

const tagsPerLine = 3;

async function generateTaggingInline(identifier: string, target: "sticker" | "stickerSet", tags?: string[]): Promise<ExtraEditMessage> {
    if (tags == undefined) {
        if (target == "sticker") {
            tags = await search.getStickerTags(identifier) || [];
        } else if (target == "stickerSet") {
            tags = await search.getStickerSetTags(identifier) || [];
        }
    }
    let inlineButtons = [[]];
    let cmdModifier, postfix;
    if (target == "sticker") {
        cmdModifier = ' ';
        postfix = ' ' + identifier;
    } else if (target == "stickerSet") {
        cmdModifier = 's ';
        postfix = '';
    }
    let isFurry = tags.indexOf('furry') > -1;
    let isNsfw = tags.indexOf('nsfw') > -1;
    // inline button commands are handled in callback_query
    inlineButtons[0].push(Markup.callbackButton('Furry: ' + (isFurry ? '✅' : '❌'), `^${cmdModifier}furry${postfix}`));
    inlineButtons[0].push(Markup.callbackButton('NSFW: ' + (isNsfw ? '✅' : '❌'), `^${cmdModifier}nsfw${postfix}`));
    tags = tags.filter(t => t != 'furry' && t != 'nsfw');

    let tmp = [];
    let idx = 0;
    tags.forEach((tag, i) => {
        if (i % tagsPerLine == 0) {
            if (tmp) {
                inlineButtons.push(tmp);
            }
            tmp = [];
        }
        // TODO: show a X only for removable tags
        // inline button commands are handled in callback_query
        tmp.push(Markup.callbackButton(tag, '-' + cmdModifier + tag + postfix));
    });
    if (tmp.length > 0) {
        inlineButtons.push(tmp);
    }

    if(target == "stickerSet") {
        inlineButtons.push([
            Markup.callbackButton("🏁 Done.", "doneTaggingSet")
        ]);
    }

    return Extra.HTML().markup(Markup.inlineKeyboard(inlineButtons));
}

async function tagSticker(chatId: number, stickerId: string, msg?: string, replyId?: number) {
    if (!msg) {
        msg = stickerTaggingMessage;
    }
    let extra: ExtraEditMessage = await generateTaggingInline(stickerId, "sticker");

    extra.reply_to_message_id = replyId;
    extra.parse_mode = 'Markdown';
    let reply = await bot.telegram.sendMessage(chatId, msg, extra);
    search.setUserState(chatId, UserState.TaggingSticker, { stickerId: stickerId, messageId: reply.message_id });
}

async function tagStickerSet(chatId: number, setName: string, stickerId: string, msg?: string, replyId?: number, stickerSet?: StickerSet) {
    if(!stickerSet) {
        stickerSet = await bot.telegram.getStickerSet(setName);
    } 
    search.addStickerSet(stickerSet, chatId);

    // index all stickers of a set
    let promises = stickerSet.stickers.map((sticker, i) => search.addSticker(sticker, chatId, i));
    await Promise.all(promises);
    console.log("done indexing", stickerSet.stickers.length, "stickers");


    if (!msg) {
        msg = getPackTaggingMessage(stickerSet.title);
    }

    let extra: ExtraEditMessage = await generateTaggingInline(stickerSet.title, "stickerSet");
    // extra.reply_to_message_id = replyId;
    extra.parse_mode = 'Markdown';
    let reply = await bot.telegram.sendMessage(chatId, msg, extra);
    search.setUserState(chatId, UserState.TaggingSet, {
        setName: setName,
        setTitle: stickerSet.title,
        messageId: reply.message_id,
        receivedStickerMsgId: replyId,
        receivedStickerId: stickerId
    });
}

bot.on('sticker', async (ctx) => {
    let sticker = ctx.message.sticker;
    let stickerId = sticker.file_id;
    console.log("received sticker", stickerId);

    // console.log(await ctx.telegram.getStickerSet(ctx.message.sticker.set_name));
    // ctx.reply(JSON.stringify(ctx.message.sticker, null, 4));

    if (! await search.stickerSetExists(sticker.set_name)) {
        let stickerSet = await ctx.getStickerSet(sticker.set_name);
        ctx.reply(`Found new sticker set "${stickerSet.title}" containing ${stickerSet.stickers.length} stickers. \nIndexing now...`);
        await tagStickerSet(ctx.chat.id, sticker.set_name, stickerId, undefined, ctx.message.message_id, stickerSet);

        // TODO: set tagging logic and afterward switching to single sticker tagging

    }
    else {
        let msg = '';
        if (! await search.stickerExists(stickerId)) {
            msg += `New untagged sticker found. Let's add some tags now.\n\n` + stickerTaggingMessage;
            await search.addSticker(ctx.message.sticker, ctx.chat.id);
        }
        await tagSticker(ctx.chat.id, stickerId, msg, ctx.message.message_id);
    }
});

// have to delay, because Elasticsearch is not instant updating
// TODO: make it instant updating (implementing other generateTaggingInline, without direct DB query)
async function updateTaggingMessage(chatId: number, messageId: number, identifier: string, target: "sticker" | "stickerSet", tags?: string[], text?: string, replyId?: number) {
    return new Promise(resolve => {
        setTimeout(async () => {
            try {
                let extra = await generateTaggingInline(identifier, target, tags);
                extra.parse_mode = 'Markdown';
                extra.reply_to_message_id = replyId;
                await bot.telegram.editMessageText(
                    chatId,
                    messageId,
                    undefined,
                    text || stickerTaggingMessage,
                    extra);
            }
            catch (err) {
                // don't print bad request errors, that happen when message is updated with same content
                if (err.code != 400) {
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

async function handleSetTaggingInput(input: string, setName: string) {
    input.replace('/tag', '');
    let tags = input.split(/[, ]+/);
    return await search.addSetTags(setName, tags);
}

// handle incoming messages that are not commands
bot.on('message', async (ctx) => {
    let cid = ctx.chat.id;

    let state = await search.getUserState(cid);
    let sd = state.userStateData;
    switch (state.userState) {
        case UserState.TaggingSticker: {
            let result = await handleTaggingInput(ctx.message.text, sd.stickerId);
            updateTaggingMessage(cid, sd.messageId, sd.stickerId, "sticker", result.body.get._source.tags, stickerTaggingMessage);
            break;
        }
        case UserState.TaggingSet: {
            let result = await handleSetTaggingInput(ctx.message.text, sd.setName);
            updateTaggingMessage(cid, sd.messageId, sd.setName, "stickerSet", result.body.get._source.tags, getPackTaggingMessage(sd.setTitle));
            break;
        }

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

async function doneTaggingSet(chatId: number) {
    let state = await search.getUserState(chatId);
    switch (state.userState) {
        case UserState.TaggingSet:
            tagSticker(chatId, state.userStateData.receivedStickerId, undefined, state.userStateData.receivedStickerMsgId);
            break;
    }
}

// process responses from inline buttons in chat (tagging interface)
bot.on('callback_query', async (ctx) => {
    let queryMsg = ctx.callbackQuery.message;
    let args = ctx.callbackQuery.data.split(' '); // splits command (eg. 'remove_tag asdf 1241512')
    let cmd = args[0], tag = args[1], stickerId = args[2];

    let cbMsg = '';
    let result;
    let target: "sticker" | "stickerSet" = "sticker";
    let taggingMsg = stickerTaggingMessage;
    // commmands get set in generateTaggingInline()
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

    let replyId;
    if (cmd.indexOf('s') > -1) { // matching like this should not cause problems down the road, because cmd still has to match the cases for a result to be returned
        let state = await search.getUserState(queryMsg.chat.id);
        replyId = state.userStateData.receivedStickerMsgId;
        target = "stickerSet"
        taggingMsg = getPackTaggingMessage(state.userStateData.setTitle);
        switch (cmd) {
            case '^s':
                result = await search.toggleSetTag(state.userStateData.setName, tag);
                cbMsg = `Toggled set flag '${tag}'`;
                break;
            case '-s':
                result = await search.removeSetTag(state.userStateData.setName, tag);
                cbMsg = `Removed set tag '${tag}'`;
                break;
        }
    }

    if (result) {
        await updateTaggingMessage(queryMsg.chat.id, queryMsg.message_id, stickerId, target, result.body.get._source.tags, taggingMsg, replyId);
        ctx.answerCbQuery(cbMsg);
    }

    if (cmd == "doneTaggingSet") {
        await doneTaggingSet(queryMsg.chat.id);
        ctx.answerCbQuery();
    }

    // console.log('received callback query:', ctx.callbackQuery);
    // console.log('CTX', ctx.message);
});

bot.startPolling();