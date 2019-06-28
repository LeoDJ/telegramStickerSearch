import * as elasticsearch from 'elasticsearch';
import { Config } from "./config";
let config: Config = require('../config.json');
import * as TT from "telegram-typings";
import { UserState } from './models/UserState';
import { InlineQueryResult } from 'telegraf/typings/telegram-types';

export class Search {
    client: elasticsearch.Client;
    constructor() {
        this.elasticSetup();

        this.client.ping({ requestTimeout: 1000 }, (error) => {
            if (error) {
                console.trace('Elasticsearch unreachable');
            }
            else {
                console.log('Connected to Elasticsearch succesfully');
            }
        })
    }

    private elasticSetup() {
        this.client = new elasticsearch.Client({
            host: config.elasticUrl,
            log: 'info'
        });
    }

    public async userExists(userId: number): Promise<boolean> {
        let result = await this.client.search({
            index: 'user',
            body: {
                query: { match: { id: userId } }
            },
            ignore: [404]
        });

        return (result.hits && result.hits.total.value) == 1;
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
            },
            ignore: [404]
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

    public async addSticker(sticker: TT.Sticker) {
        let result: any;
        try {
            result = await this.client.search({
                index: 'sticker',
                body: {
                    query: { match: { file_id: sticker.file_id } }
                },
                ignore: [404]
            });
        }
        catch (e) {
            console.trace(e);
        }

        if (result.status == 404 || result.hits.total.value == 0) {
            console.log("Adding new sticker " + sticker.file_id);
            this.client.index({
                index: 'sticker',
                type: '_doc',
                id: sticker.file_id,
                body: {
                    set_name: sticker.set_name,
                    file_id: sticker.file_id,
                    emoji_string: sticker.emoji
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
        console.log("ES sticker search result", result, result.hits.hits);

        return result.hits.hits.map(res =>
            <TT.InlineQueryResultCachedSticker>{
                type: "sticker",
                id: res._source.file_id,
                sticker_file_id: res._source.file_id
            }
        );

    }
}