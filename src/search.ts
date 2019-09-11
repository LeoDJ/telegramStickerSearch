import * as es from '@elastic/elasticsearch';
import { Config } from "./config";
let config: Config = require('../config.json');
import * as TT from "telegram-typings";
import { UserState, UserStateData } from './models/UserState';
import { StickerTag, StickerTagType } from './models/StickerTag';
import { InlineQueryResult } from 'telegraf/typings/telegram-types';
import { emojiToUnicode, emojiStringToArray, emojiToTelegramUnicode } from './emoji';
let emojiData = require('../data/emoji_autocomplete.json');

export class Search {
    client: es.Client;
    constructor() {
        this.elasticSetup();

        this.client.ping({}, (error) => {
            if (error) {
                console.trace('Elasticsearch unreachable');
            }
            else {
                console.log('Connected to Elasticsearch succesfully');
            }
        });
    }

    private elasticSetup() {
        this.client = new es.Client({
            node: config.elasticUrl,
            // log: 'info'
        });
    }

    // ######################################################################################
    // ######################    User Stuff    ##############################################
    // ######################################################################################

    public async userExists(userId: number): Promise<boolean> {
        try {
            let result = await this.client.search({
                index: 'user',
                body: {
                    query: { match: { id: userId } }
                }
            });

            return (result.body.hits && result.body.hits.total.value) == 1;
        }
        catch (err) {
            // console.trace(err);
            return false;
        }
    }

    public async getUserState(userId: number) {
        try {
            let result = await this.client.search({
                index: 'user',
                body: {
                    query: { match: { id: userId } }
                }
            });
            let user = result.body.hits.hits[0]._source;
            return {
                userState: user.user_state,
                userStateData: <UserStateData>user.user_state_data
            }
        }
        catch (e) {
            // console.trace(e);
            return {};
        }
    }

    public async setUserState(userId: number, userState: UserState, userStateData?: UserStateData) {
        if (userStateData == undefined) {
            userStateData = {};
        }
        this.client.update({
            index: 'user',
            type: '_doc',
            id: String(userId),
            body: {
                doc: {
                    user_state: userState,
                    user_state_data: userStateData
                }
            }
        });
    }

    public async initUser(userId: number) {
        return this.setUserState(userId, UserState.Initialized, {});
    }

    public async registerUser(user: TT.User) {
        let result = await this.client.index({
            index: 'user',
            type: '_doc',
            id: String(user.id),

            body: user
        });

        this.initUser(user.id);
    }

    // ######################################################################################
    // ######################    Sticker Stuff    ###########################################
    // ######################################################################################

    public async addSticker(sticker: TT.Sticker, addedByUserId: number, setPosition?: number) {
        // console.log(emojiToTelegramUnicode(sticker.emoji));

        if (! await this.stickerExists(sticker.file_id)) {
            console.log("Adding new sticker", sticker.file_id, sticker.emoji, sticker.set_name);

            let emojiAliases = emojiData[emojiToTelegramUnicode(sticker.emoji)];
            // console.log(sticker.emoji, emojiAliases),

            this.client.index({
                index: 'sticker',
                type: '_doc',
                id: sticker.file_id,
                body: {
                    set_name: sticker.set_name,
                    file_id: sticker.file_id,
                    emoji: sticker.emoji,
                    added_by: addedByUserId,
                    set_position: setPosition,
                    is_animated: sticker.is_animated,
                    tags: [],
                    emoji_str: emojiAliases
                }
            });
        }
    }

    public async stickerExists(fileId: string): Promise<boolean> {
        let result: any;
        try {
            result = await this.client.search({
                index: 'sticker',
                body: {
                    query: { match: { file_id: fileId } }
                }
            });
            return (result.statusCode != 404 && result.body.hits.total.value > 0);
        }
        catch (e) {
            // console.trace(e);
            console.error('No "sticker" index exists, will probably get created now');
            return false;
        }
    }

    public async getStickerTags(fileId: string): Promise<StickerTag[]> {
        try {
            let result = await this.client.search({
                index: 'sticker',
                body: {
                    query: { match: { file_id: fileId } }
                }
            });
            return result.body.hits.hits[0]._source.tags;
        }
        catch (e) {
            // consol8e.trace(e);
            return [];
        }
    }

    public async tagOperation(fileId: string, tag: StickerTag | StickerTag[], script: string) {
        let result;
        try {
            return await this.client.update({
                index: 'sticker',
                id: fileId,
                _source: true,
                body: {
                    script: {
                        source: `
                            if(ctx._source?.tags == null) {
                                ctx._source.tags = [];
                            }
                            ${script}`,
                            params: {
                                tag: tag
                            }
                        }
                    }
                });
        } catch (err) {
            console.trace(err);
            console.log(err.meta.body.error);
        }
    }
    
    public async addTags(fileId: string, tags: string[], user: number) {
        tags = tags.map(t => t.toLowerCase());
        let stickerTags: StickerTag[] = tags.map(t => <StickerTag>{tag: t, type: StickerTagType.UserAdded, added_by: user, added_at: Date.now()});

        return this.tagOperation(fileId, stickerTags, `
        if(ctx._source?.tags != null) {
            def tags = ctx._source.tags.stream().map(t -> t.tag).collect(Collectors.toList());

            for(t in params.tag) {
                if(!tags.contains(t.tag)) {
                    ctx._source.tags.add(t);
                }
            }
        }
        `);
    }
    
    //TODO: check, if user is privileged to remove the tag
    public async removeTag(fileId: string, tag: string, user: number) {
        tag = tag.toLowerCase();
        return this.tagOperation(fileId, <StickerTag>{tag: tag, type: StickerTagType.UserAdded, added_by: user}, `
        ctx._source.tags = ctx._source.tags.stream().filter(t -> t.tag != params.tag.tag).collect(Collectors.toList());
        `);
    }
    
    //TODO: check, if user is privileged to remove the tag
    public async toggleTag(fileId: string, tag: string, user: number) {
        tag = tag.toLowerCase();
        let stickerTag = <StickerTag>{tag: tag, type: StickerTagType.UserAdded, added_by: user, added_at: Date.now()}
        return this.tagOperation(fileId, stickerTag, `
        def tags = ctx._source.tags.stream().map(t -> t.tag).collect(Collectors.toList());
        if (!tags.contains(params.tag.tag)) { 
            ctx._source.tags.add(params.tag);
        } else { 
            ctx._source.tags = ctx._source.tags.stream().filter(t -> t.tag != params.tag.tag).collect(Collectors.toList());
        }`);
    }

    // ######################################################################################
    // ######################    Sticker Set Stuff    #######################################
    // ######################################################################################

    public async addStickerSet(stickerSet: TT.StickerSet, addedByUserId: number) {
        console.log("Adding new sticker set " + stickerSet.name);

        this.client.index({
            index: 'sticker_set',
            type: '_doc',
            id: stickerSet.name,
            body: {
                set_name: stickerSet.name,
                set_title: stickerSet.title,
                indexed_at: Date.now(),
                added_by: addedByUserId,
                sticker_count: stickerSet.stickers.length,
                title_sticker: stickerSet.stickers[0].file_id
            }
        });
    }

    public async stickerSetExists(setName: string): Promise<boolean> {
        let result = await this.getStickerSet(setName);
        // console.log("sticker set exists", setName, result, result != null);
        return (result != null);
    }

    public async getStickerSet(setName: string): Promise<object> {
        try {
            let result = await this.client.get({
                index: 'sticker_set',
                id: setName
            });
            // console.log(result);
            if (result.body.found) {
                return result.body._source;
            } else {
                return null;
            }
        }
        catch (e) {
            // console.trace(e);
            return null;
        }
    }

    public async getStickerSetTags(setName: string): Promise<string[]> {
        // TODO: implement
        return [];

    }
    
    public async setTagOperation(setName: string, tag: string[], script: string) {
        // TODO: implement

    }
    
    public async addSetTags(setName: string, tags: string[]) {
        // TODO: implement
        console.log("add set tags", tags);
        return {body: {get: {_source: {tags: ['a_tag']}}}};
    }
    
    public async removeSetTag(setName: string, tag: string) {
        // TODO: implement
        console.log("remove set tag", tag);
        return {body: {get: {_source: {tags: ['a_tag']}}}};
    }
    
    public async toggleSetTag(setName: string, tag: string) {
        // TODO: implement
        console.log("toggle set tag", tag);
        return {body: {get: {_source: {tags: ['a_tag']}}}};
    }

    // ######################################################################################
    // ######################    Search Stuff    ############################################
    // ######################################################################################

    public async searchSticker(query: string, userId: number, offset: number = 0): Promise<InlineQueryResult[]> {
        let result = await this.client.search({
            index: 'sticker',
            from: offset,
            size: 50, // telegram inline expects a maximum of 50 results
            body: {

            }
        })
        console.log("ES sticker search result", result.body, result.body.hits.hits);

        return result.body.hits.hits.map(res =>
            <TT.InlineQueryResultCachedSticker>{
                type: "sticker",
                id: res._source.file_id,
                sticker_file_id: res._source.file_id
            }
        );

    }

}