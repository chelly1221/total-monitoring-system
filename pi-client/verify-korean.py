#!/usr/bin/python3
"""Check installed font coverage and the real offline Hangul composition library."""
import ctypes
import ctypes.util
import locale
import subprocess


def verify():
    locale.setlocale(locale.LC_ALL, 'ko_KR.UTF-8')
    font = '/usr/local/share/fonts/pretendard/PretendardVariable.ttf'
    charset = subprocess.check_output(['fc-query', '--format=%{charset}', font], text=True)
    points = set()
    for span in charset.split():
        bounds = span.split('-')
        points.update(range(int(bounds[0], 16), int(bounds[-1], 16) + 1))
    # All 11,172 modern Hangul syllables, not a downloaded-on-demand subset.
    assert set(range(0xAC00, 0xD7A4)) <= points, '한글 전체 글리프가 없습니다'
    assert all(ord(c) in points for c in 'ㄱㄴㅏㅘ한글 장비실 ℃%0123456789ABC'), '표시 글리프가 없습니다'
    lib = ctypes.CDLL(ctypes.util.find_library('hangul'))
    lib.hangul_ic_new.argtypes = [ctypes.c_char_p]
    lib.hangul_ic_new.restype = ctypes.c_void_p
    lib.hangul_ic_process.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.hangul_ic_get_commit_string.argtypes = [ctypes.c_void_p]
    lib.hangul_ic_get_commit_string.restype = ctypes.POINTER(ctypes.c_uint32)
    lib.hangul_ic_flush.argtypes = [ctypes.c_void_p]
    lib.hangul_ic_flush.restype = ctypes.POINTER(ctypes.c_uint32)
    lib.hangul_ic_backspace.argtypes = [ctypes.c_void_p]
    lib.hangul_ic_get_preedit_string.argtypes = [ctypes.c_void_p]
    lib.hangul_ic_get_preedit_string.restype = ctypes.POINTER(ctypes.c_uint32)
    lib.hangul_ic_delete.argtypes = [ctypes.c_void_p]

    def read(ptr):
        result = ''
        i = 0
        while ptr[i]:
            result += chr(ptr[i])
            i += 1
        return result

    for keys, expected in [('gksrmf', '한글'), ('wkdqltlf', '장비실'), ('rkqt', '값'), ('rhk', '과')]:
        context = lib.hangul_ic_new(b'2')
        assert context, '두벌식 입력기를 초기화할 수 없습니다'
        try:
            actual = ''
            for key in keys:
                lib.hangul_ic_process(context, ord(key))
                actual += read(lib.hangul_ic_get_commit_string(context))
            actual += read(lib.hangul_ic_flush(context))
            assert actual == expected, (actual, expected)
        finally:
            lib.hangul_ic_delete(context)
    context = lib.hangul_ic_new(b'2')
    assert context, '두벌식 입력기를 초기화할 수 없습니다'
    try:
        for key in 'rkqt':
            lib.hangul_ic_process(context, ord(key))
        for expected in ('갑', '가', 'ㄱ', ''):
            lib.hangul_ic_backspace(context)
            assert read(lib.hangul_ic_get_preedit_string(context)) == expected
    finally:
        lib.hangul_ic_delete(context)
    print('Korean locale/font/composition checks passed')


if __name__ == '__main__':
    verify()
