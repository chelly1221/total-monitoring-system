"""Two-set Hangul composition for the local touch keyboard, with no network IME."""
LEADS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
TAILS = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'
KEYS = dict(zip('rRseEfaqQtTdwWczxvgkoiOjpuPhynbml', 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ'))
VOWEL_PAIRS = dict(zip(['ㅗㅏ', 'ㅗㅐ', 'ㅗㅣ', 'ㅜㅓ', 'ㅜㅔ', 'ㅜㅣ', 'ㅡㅣ'], 'ㅘㅙㅚㅝㅞㅟㅢ'))
TAIL_PAIRS = dict(zip(['ㄱㅅ', 'ㄴㅈ', 'ㄴㅎ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅂㅅ'], 'ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'))
TAIL_SPLIT = {v: k for k, v in TAIL_PAIRS.items()}


def compose(keys):
    result, lead, vowel, tail = '', '', '', ''

    def syllable():
        if lead and vowel:
            return chr(0xAC00 + (LEADS.index(lead) * 21 + VOWELS.index(vowel)) * 28 + (TAILS.index(tail) if tail else 0))
        return lead or vowel

    for key in keys:
        c = KEYS.get(key, key)
        if c in VOWELS:
            if lead and vowel and tail:
                parts = TAIL_SPLIT.get(tail)
                moving = parts[1] if parts else tail
                tail = parts[0] if parts else ''
                result += syllable()
                lead, vowel, tail = moving, c, ''
            elif vowel and vowel + c in VOWEL_PAIRS:
                vowel = VOWEL_PAIRS[vowel + c]
            elif not vowel:
                vowel = c
            else:
                result += syllable()
                lead, vowel, tail = '', c, ''
        elif c in LEADS:
            if lead and vowel and not tail and c in TAILS:
                tail = c
            elif tail and tail + c in TAIL_PAIRS:
                tail = TAIL_PAIRS[tail + c]
            else:
                result += syllable()
                lead, vowel, tail = c, '', ''
        else:
            result += syllable() + c
            lead, vowel, tail = '', '', ''
    return result + syllable()
