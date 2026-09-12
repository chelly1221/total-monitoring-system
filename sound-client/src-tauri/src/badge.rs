//! Draws a short countdown label (e.g. "45", "2h", "30") over a state icon so the
//! remaining unmute time is visible on the tray / taskbar icon itself, without
//! hovering for the tooltip. Uses a tiny built-in 3x5 pixel font: no font crates.

use tauri::image::Image;

/// 3x5 glyphs, one row per entry, MSB = left pixel.
fn glyph(c: char) -> Option<[u8; 5]> {
    Some(match c {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b001, 0b001, 0b001],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        'h' => [0b100, 0b100, 0b111, 0b101, 0b101],
        _ => return None,
    })
}

/// Label for the remaining seconds: hours ("2h") above an hour, whole minutes
/// (rounded up) above a minute, otherwise seconds. Always 1–2 characters.
pub fn countdown_label(remaining_sec: u64) -> String {
    if remaining_sec >= 3600 {
        format!("{}h", (remaining_sec / 3600).min(9))
    } else if remaining_sec >= 60 {
        format!("{}", remaining_sec.div_ceil(60).min(59))
    } else {
        format!("{remaining_sec}")
    }
}

/// True when the label should be drawn in the "last minute" colour.
pub fn is_final_minute(remaining_sec: u64) -> bool {
    remaining_sec < 60
}

/// Composite `text` (1–2 glyphs) centred on the decoded PNG icon and return a new image.
pub fn render(base_png: &[u8], text: &str, rgb: [u8; 3]) -> Result<Image<'static>, tauri::Error> {
    let base = Image::from_bytes(base_png)?;
    let (w, h) = (base.width() as usize, base.height() as usize);
    let mut px = base.rgba().to_vec();

    let glyphs: Vec<[u8; 5]> = text.chars().filter_map(glyph).collect();
    if glyphs.is_empty() || w < 16 || h < 16 {
        return Ok(Image::new_owned(px, w as u32, h as u32));
    }

    // Scale so that two glyphs (3+1+3 cells wide, 5 tall) fill ~80% of the icon.
    let cells_w = glyphs.len() * 3 + (glyphs.len() - 1);
    let scale = ((w * 4 / 5) / cells_w.max(1)).min(h * 3 / 5 / 5).max(1);
    let text_w = cells_w * scale;
    let text_h = 5 * scale;
    let x0 = (w - text_w) / 2;
    let y0 = (h - text_h) / 2;

    // Dark translucent plate behind the digits for legibility on any icon colour.
    let pad = scale.max(2);
    let (bx0, by0) = (x0.saturating_sub(pad), y0.saturating_sub(pad));
    let (bx1, by1) = ((x0 + text_w + pad).min(w), (y0 + text_h + pad).min(h));
    for y in by0..by1 {
        for x in bx0..bx1 {
            blend(&mut px, w, x, y, [20, 20, 24], 190);
        }
    }

    for (gi, g) in glyphs.iter().enumerate() {
        let gx = x0 + gi * 4 * scale;
        for (row, bits) in g.iter().enumerate() {
            for col in 0..3 {
                if bits & (0b100 >> col) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let (x, y) = (gx + col * scale + dx, y0 + row * scale + dy);
                        if x < w && y < h {
                            blend(&mut px, w, x, y, rgb, 255);
                        }
                    }
                }
            }
        }
    }
    Ok(Image::new_owned(px, w as u32, h as u32))
}

fn blend(px: &mut [u8], w: usize, x: usize, y: usize, rgb: [u8; 3], alpha: u8) {
    let i = (y * w + x) * 4;
    if i + 3 >= px.len() {
        return;
    }
    let a = alpha as u32;
    for c in 0..3 {
        px[i + c] = ((rgb[c] as u32 * a + px[i + c] as u32 * (255 - a)) / 255) as u8;
    }
    // Result alpha: source over destination.
    let da = px[i + 3] as u32;
    px[i + 3] = (a + da * (255 - a) / 255) as u8;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_short() {
        assert_eq!(countdown_label(2 * 3600 + 5), "2h");
        assert_eq!(countdown_label(3599), "59");
        assert_eq!(countdown_label(61), "2");
        assert_eq!(countdown_label(60), "1");
        assert_eq!(countdown_label(59), "59");
        assert_eq!(countdown_label(0), "0");
    }
}
