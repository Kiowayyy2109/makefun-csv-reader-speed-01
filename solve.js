// Fast single-pass reader for broken CSV, reproducing csv-reader 1.0.0's answers exactly.
//
// Strategy: never walk the text character by character in JS when a native
// search can jump straight to the next interesting position. Unquoted fields
// are located with indexOf for the comma and the line feed, quoted fields with
// indexOf for the closing quote, and field values come out as slices of the
// original string. A monotone cursor caches the next carriage return so CR
// checks across the whole parse cost one native pass in total. Only fields
// that actually contain a stray CR, a doubled quote or a CR inside quotes
// drop to a segment-building path that stitches slices together.
//
// Semantics (identical to the reference):
// - a leading U+FEFF is dropped; records end at LF or CRLF; empty lines and
//   lines reduced to nothing by stray CRs are not records;
// - a CR outside quotes that is not part of CRLF is dropped (stray_cr);
// - a field starting with a quote runs to the next undoubled quote; "" means
//   one quote and CR / CRLF inside quotes each read as a single LF; text
//   after the closing quote up to the next comma or line break is appended
//   verbatim (quote_junk if anything was appended); a quote that never
//   closes is a literal character and the rest is re-read unquoted
//   (unterminated_quote); a quote inside an unquoted field is literal;
// - fields are never trimmed; rows are padded (short_row) or cut (long_row)
//   to the first record's width; errors are {code, line, row} in the order
//   met, where line is the 1-based line the record starts on (counting every
//   line break inside quoted fields) and row is the record's index in rows,
//   or null for the header.

// How a field ended: 0 = comma, 1 = line break, 2 = end of text.

export function run(input) {
  const s = String(input.text);
  const header = input.header === true;
  const n = s.length;

  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // next unread index
  let line = 1; // 1-based line that index sits on
  if (n > 0 && s.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1; // line the current record starts on
  let recordRow = null; // its index in rows (null: the header)

  // Index of the next CR at or after every position seen so far. pos only
  // moves forward, so refreshing this lazily keeps all CR lookups together
  // at one native scan of the text per call.
  let crNext = s.indexOf('\r', pos);

  // The field most recently scanned.
  let fVal = '';
  let fEnded = 2;
  let fAdded = 0; // characters the last unquoted scan kept

  function refreshCr(from) {
    if (crNext !== -1 && crNext < from) crNext = s.indexOf('\r', from);
  }

  function endField(term, end) {
    if (term === 0) {
      pos = end + 1;
      fEnded = 0;
    } else if (term === 1) {
      pos = end + 1;
      line += 1;
      fEnded = 1;
    } else {
      pos = n;
      fEnded = 2;
    }
  }

  // Scan an unquoted field starting at pos, seeding its value with `initial`
  // ('' normally, '"' for an unterminated quote re-read, or the quoted value
  // when scanning quote junk). Sets fVal, fEnded, fAdded; stray CRs report
  // themselves as they are met.
  function scanUnquoted(initial) {
    const start = pos;
    const commaAt = s.indexOf(',', start);
    const lfAt = s.indexOf('\n', start);
    let end;
    let term;
    if (lfAt === -1 || (commaAt !== -1 && commaAt < lfAt)) {
      if (commaAt === -1) {
        end = n;
        term = 2;
      } else {
        end = commaAt;
        term = 0;
      }
    } else {
      end = lfAt;
      term = 1;
    }

    refreshCr(start);
    if (crNext === -1 || crNext >= end) {
      // No CR inside the field: the value is one slice.
      fVal = initial === '' ? s.slice(start, end) : initial + s.slice(start, end);
      fAdded = end - start;
      endField(term, end);
      return;
    }
    if (crNext === end - 1 && term === 1) {
      // The only CR is the CR of the closing CRLF.
      fVal = initial === '' ? s.slice(start, end - 1) : initial + s.slice(start, end - 1);
      fAdded = end - 1 - start;
      pos = end + 1;
      line += 1;
      fEnded = 1;
      return;
    }

    // Rare path: stray CRs inside the field. Stitch the kept segments.
    let buf = initial;
    let seg = start;
    let k = crNext;
    while (k !== -1 && k < end) {
      if (k === end - 1 && term === 1) {
        buf += s.slice(seg, k);
        fVal = buf;
        fAdded = buf.length - initial.length;
        pos = end + 1;
        line += 1;
        fEnded = 1;
        return;
      }
      buf += s.slice(seg, k);
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      seg = k + 1;
      k = s.indexOf('\r', seg);
      crNext = k;
    }
    buf += s.slice(seg, end);
    fVal = buf;
    fAdded = buf.length - initial.length;
    endField(term, end);
  }

  // After a closing quote at pos: finish the field from what follows it.
  function finishQuoted(value) {
    if (pos >= n) {
      fVal = value;
      fEnded = 2;
      return;
    }
    const c = s.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fVal = value;
      fEnded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fVal = value;
      fEnded = 1;
      return;
    }
    if (c === 13 && s.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = value;
      fEnded = 1;
      return;
    }
    // Junk after the closing quote is appended as it stands.
    scanUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Scan a field whose opening quote is at pos.
  function scanQuoted() {
    const open = pos;
    const openLine = line;
    const body = open + 1;

    const close = s.indexOf('"', body);
    if (close === -1) {
      // No other quote in the text: this one never closes. The re-read
      // below rewinds pos, so the CR cursor (which only moves forward)
      // must be recomputed for the rewound position.
      pos = body;
      line = openLine;
      crNext = s.indexOf('\r', body);
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      scanUnquoted('"');
      return;
    }
    if (s.charCodeAt(close + 1) !== 34) {
      refreshCr(body);
      if (crNext === -1 || crNext >= close) {
        // Plain quoted body: count its line feeds, take it as one slice.
        let lf = s.indexOf('\n', body);
        while (lf !== -1 && lf < close) {
          line += 1;
          lf = s.indexOf('\n', lf + 1);
        }
        const value = s.slice(body, close);
        pos = close + 1;
        finishQuoted(value);
        return;
      }
    }

    // General path: doubled quotes and/or CRs inside the body. Walk the
    // specials, cutting the value only where a character changes.
    let buf = '';
    let seg = body;
    let i = body;
    for (;;) {
      const quoteAt = s.indexOf('"', i);
      const lfAt = s.indexOf('\n', i);
      refreshCr(i);
      let k = -1;
      let kind = 0; // 1 quote, 2 CR, 3 LF
      if (quoteAt !== -1) {
        k = quoteAt;
        kind = 1;
      }
      if (crNext !== -1 && (k === -1 || crNext < k)) {
        k = crNext;
        kind = 2;
      }
      if (lfAt !== -1 && (k === -1 || lfAt < k)) {
        k = lfAt;
        kind = 3;
      }
      if (k === -1) {
        // Ran out of text before any closing quote. Rewind, as above.
        pos = body;
        line = openLine;
        crNext = s.indexOf('\r', body);
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        scanUnquoted('"');
        return;
      }
      if (kind === 3) {
        line += 1;
        i = k + 1;
        continue;
      }
      if (kind === 2) {
        // CR or CRLF inside quotes reads as one LF.
        buf += s.slice(seg, k) + '\n';
        line += 1;
        i = k + 1;
        if (s.charCodeAt(i) === 10) i += 1;
        seg = i;
        crNext = s.indexOf('\r', i);
        continue;
      }
      if (s.charCodeAt(k + 1) === 34) {
        buf += s.slice(seg, k) + '"';
        i = k + 2;
        seg = i;
        continue;
      }
      buf += s.slice(seg, k);
      pos = k + 1;
      finishQuoted(buf);
      return;
    }
  }

  for (;;) {
    // Blank lines (nothing, or only a line break) start no record.
    while (pos < n) {
      const c = s.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && s.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let lastQuoted = false;
    do {
      if (s.charCodeAt(pos) === 34) {
        lastQuoted = true;
        scanQuoted();
      } else {
        lastQuoted = false;
        scanUnquoted('');
      }
      fields.push(fVal);
    } while (fEnded === 0);

    // A line whose characters were all stray CRs leaves no record behind
    // (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}
