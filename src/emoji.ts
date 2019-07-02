// uses code from https://github.com/IonicaBizau/emoji-unicode/pull/13

export const emojiStringToArray = (str) => {
    let split = str.split(/([\uD800-\uDBFF][\uDC00-\uDFFF])/);
    let arr = [];
    for (var i = 0; i < split.length; i++) {
        let char = split[i]
        if (char !== "") {
            arr.push(char);
        }
    }
    return arr;
};

export const emojiToTelegramUnicode = (input) => {
    return emojiToUnicode(input).split(' ').filter(e => e != '200d' && e != 'fe0f').join('-');
}

export const emojiToUnicode = (input) => {
    return emojiToUnicodeRaw(input).split(' ').map(val => parseInt(val).toString(16)).join(' ')
}

export const emojiToUnicodeRaw = (input) => {
    if (input.length === 1) {
        return input.charCodeAt(0);
    }
    if (input.length > 1) {
        const pairs = [];
        for (var i = 0; i < input.length; i++) {
            // high surrogate
            if (input.charCodeAt(i) >= 0xd800 && input.charCodeAt(i) <= 0xdbff) {
                if (input.charCodeAt(i + 1) >= 0xdc00 && input.charCodeAt(i + 1) <= 0xdfff) {
                    // low surrogate
                    let comp = (
                        (input.charCodeAt(i) - 0xd800) * 0x400
                        + (input.charCodeAt(i + 1) - 0xdc00) + 0x10000
                    );
                    pairs.push(comp);
                }
            } else if (input.charCodeAt(i) < 0xd800 || input.charCodeAt(i) > 0xdfff) {
                // modifiers and joiners
                pairs.push(input.charCodeAt(i));
            }
        }
        return pairs.join(' ');
    }
    else {
        return '';
    }
}