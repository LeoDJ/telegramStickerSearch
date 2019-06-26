import * as elasticsearch from 'elasticsearch';
import { Config } from "./config";
let config: Config = require('../config.json');
import * as TT from "telegram-typings";

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
            console.log(e);
        }

        console.log(result);

        if (result.status == 404 || result.hits.total == 0) {
            console.log("Adding new sticker " + sticker.file_id);
            this.client.index({
                index: 'sticker',
                type: '_doc',

                body: {
                    set_name: sticker.set_name,
                    file_id: sticker.file_id,
                    emoji_string: sticker.emoji
                }
            })
        }


    }
}