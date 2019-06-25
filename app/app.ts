import * as mongoose from "mongoose";
import { Config } from "./config";
let config: Config = require('../config.json');
import * as bot from "./bot"


class App {
    constructor() {
        this.mongoSetup();
    }

    private mongoSetup() {
        // mongoose.Promise = global.Promise;
        mongoose.connect(config.mongoUrl, (err: any) => {
            if (err) {
                console.log(err.message);
            } else {
                console.log("MongoDB connection successful.");
            }
        });
    }
}

export default new App();