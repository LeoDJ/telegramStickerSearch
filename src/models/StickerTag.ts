export enum StickerTagType {
    UserAdded = 'user',
    OCR = 'ocr',
    SetName = 'set_name'
}

export type StickerTag = {
    tag: string,
    type: StickerTagType,
    added_by: number,       //user id
    added_at: number
}