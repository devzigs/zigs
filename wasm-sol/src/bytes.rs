//! Bounds-checked byte reader. No slice index can panic.

/// The input ended before the field did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Short;

/// Reads little-endian fields from a byte slice.
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    pub fn take(&mut self, n: usize) -> Result<&'a [u8], Short> {
        let end = self.pos.checked_add(n).ok_or(Short)?;
        let out = self.buf.get(self.pos..end).ok_or(Short)?;
        self.pos = end;
        Ok(out)
    }

    pub fn array<const N: usize>(&mut self) -> Result<[u8; N], Short> {
        self.take(N)?.try_into().map_err(|_| Short)
    }

    pub fn u8(&mut self) -> Result<u8, Short> {
        let [byte] = self.array::<1>()?;
        Ok(byte)
    }

    pub fn u16(&mut self) -> Result<u16, Short> {
        Ok(u16::from_le_bytes(self.array()?))
    }

    pub fn u32(&mut self) -> Result<u32, Short> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    pub fn u64(&mut self) -> Result<u64, Short> {
        Ok(u64::from_le_bytes(self.array()?))
    }

    pub fn is_empty(&self) -> bool {
        self.pos == self.buf.len()
    }
}

/// Lower-case hex of a byte slice.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The first four bytes as hex, for short messages.
pub fn short_hex(bytes: &[u8]) -> String {
    hex(bytes.get(..4).unwrap_or(bytes))
}
