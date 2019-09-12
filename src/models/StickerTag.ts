export enum StickerTagType {
    UserAdded = 'user',
    UserAddedSet = 'set_set',
    Emoji = 'emoji',
    EmojiAlias = 'emoji_alias',
    Metadata = 'metadata',
    OCR = 'ocr',
    SetName = 'set_name'
}

export type StickerTag = {
    tag: string,
    type: StickerTagType,
    added_by: number,       //user id
    added_at: number
}