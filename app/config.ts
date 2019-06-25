export interface Config {
    mongoUrl: string;
    elasticUrl: string;
    telegram: {
        botToken: string;
    }
}