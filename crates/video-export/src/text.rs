//! Les fichiers SRT dans la nature sont en UTF-8, UTF-8 avec BOM, UTF-16 ou — très souvent pour le
//! français — Windows-1252. Les lire tous en UTF-8 transforme chaque lettre accentuée de ces
//! derniers en U+FFFD.

/// Windows-1252 ne diffère de Latin-1 que sur 0x80–0x9F (guillemets courbes, tirets, €…).
const CP1252_HIGH: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
];

fn decode_windows_1252(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| {
            if (0x80..=0x9f).contains(&b) {
                CP1252_HIGH[(b - 0x80) as usize]
            } else {
                b as char
            }
        })
        .collect()
}

#[allow(clippy::chunks_exact_to_as_chunks)]
fn utf16(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| {
            if little_endian {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

pub fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) {
        return utf16(&bytes[2..], true);
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        return utf16(&bytes[2..], false);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.strip_prefix('\u{FEFF}').unwrap_or(s).to_string(),
        Err(_) => decode_windows_1252(bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_is_read_as_is_and_a_bom_is_dropped() {
        assert_eq!(decode_text("été".as_bytes()), "été");
        assert_eq!(decode_text(b"\xef\xbb\xbfhello"), "hello");
    }

    #[test]
    fn utf16_in_both_byte_orders_is_understood() {
        assert_eq!(decode_text(&[0xff, 0xfe, b'h', 0, 0xe9, 0]), "hé");
        assert_eq!(decode_text(&[0xfe, 0xff, 0, b'h', 0, 0xe9]), "hé");
    }

    #[test]
    fn windows_1252_keeps_accents_and_curly_quotes() {
        assert_eq!(decode_text(b"caf\xe9"), "café");
        assert_eq!(decode_text(b"\x93hi\x94 \x80"), "“hi” €");
    }

    #[test]
    fn empty_input_is_empty() {
        assert_eq!(decode_text(b""), "");
    }
}
