import * as es from '@elastic/elasticsearch';
import { Config } from "./config";
let config: Config = require('../config.json');
import * as TT from "telegram-typings";
import { UserState } from './models/UserState';
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

    public async initUser(userId: number) {
        this.client.update({
            index: 'user',
            type: '_doc',
            id: String(userId),
            body: {
                doc: {
                    user_state: UserState.Initialized,
                    user_state_data: {}
                }
            }
        });
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

    public async getStickerTags(fileId: string): Promise<string[]> {
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
            // console.trace(e);
            return [];
        }
    }

    public async removeTag(fileId: string, tag: string) {
        try {
            let result = await this.client.update({
                index: 'sticker',
                type: '_doc',
                id: fileId,
                script: 'ctx._source.tags.remove(tag)',
                params: {
                    tag: tag
                }
            });
        } catch (err) {
            console.trace(err);
        }
    }


    public async addSticker(sticker: TT.Sticker) {
        console.log(emojiToTelegramUnicode(sticker.emoji));

        if (! await this.stickerExists(sticker.file_id)) {
            console.log("Adding new sticker " + sticker.file_id);

            let emojiAliases = emojiData[emojiToTelegramUnicode(sticker.emoji)];
            console.log(sticker.emoji, emojiAliases),

                this.client.index({
                    index: 'sticker',
                    type: '_doc',
                    id: sticker.file_id,
                    body: {
                        set_name: sticker.set_name,
                        file_id: sticker.file_id,
                        emoji: sticker.emoji,
                        emoji_str: emojiAliases
                    }
                });
        }
    }

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