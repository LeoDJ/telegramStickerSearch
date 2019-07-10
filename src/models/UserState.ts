export enum UserState {
    Initialized = 'initialized',
    TaggingSticker = 'taggingSticker',
    TaggingSet = 'taggingSet',
    TaggingSetBulk = 'taggingSetBulk'
}

export type UserStateData = {
    stickerId?: string,                 // file_id of the sticker currently being tagged
    messageId?: number,                 // id of the message with the inline buttons
    setName?: string,                   // set_name of the sticker set currently being tagged
    setTitle?: string,                  // set_title     - " -
    receivedStickerMsgId?: number,      // message_id of the sticker that initialized the "tagging set" mode
    receivedStickerId?: string          // file_id of the sticker that initialized the "tagging set" mode
}