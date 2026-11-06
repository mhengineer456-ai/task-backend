import { accessoryQuery, isAccessoryConnected, getAccessoryDbStatus, initAccessoryDatabase } from '../config/accessoryDb.js';

function safeParseJson(raw, fallback = null) {
  if (!raw) return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

/**
 * Clean lot number helper
 */
function cleanLot(lot) {
  return String(lot || '').replace(/^LOT[-_\s]*/i, '').trim();
}

/**
 * Brand & Trim Synonyms and Phonetic Alias Mapping
 * Handles common operator spelling variations, double-letter discrepancies, and transliteration differences.
 */
export const BRAND_SYNONYMS = {
  adidas: ['adidas', 'addidas', 'adiddas', 'adida', 'adidass', 'addidass'],
  addidas: ['adidas', 'addidas', 'adiddas', 'adida', 'adidass', 'addidass'],
  chanel: ['chanel', 'channal', 'channel', 'chenal', 'chanell', 'channell'],
  channal: ['chanel', 'channal', 'channel', 'chenal', 'chanell', 'channell'],
  trapstar: ['trapstar', 'trapster', 'trap star', 'trap ster'],
  trapster: ['trapstar', 'trapster', 'trap star', 'trap ster'],
  burberry: ['burberry', 'burburry', 'burbery', 'barbour', 'burbour', 'barbari'],
  burburry: ['burberry', 'burburry', 'burbery', 'barbour', 'burbour', 'barbari'],
  essentials: ['essentials', 'essentinal', 'essential', 'fog', 'fear of god'],
  essentinal: ['essentials', 'essentinal', 'essential', 'fog', 'fear of god'],
  hermes: ['hermes', 'herms', 'hermez'],
  herms: ['hermes', 'herms', 'hermez'],
  loropiana: ['loropiana', 'loropiane', 'loro piana', 'loro piane'],
  loropiane: ['loropiana', 'loropiane', 'loro piana', 'loro piane'],
  hackett: ['hackett', 'hacket'],
  hacket: ['hackett', 'hacket'],
  calvinklein: ['calvin klein', 'calvin', 'ck', 'c.k', 'c.k.'],
  ck: ['calvin klein', 'calvin', 'ck', 'c.k', 'c.k.'],
  'c.k': ['calvin klein', 'calvin', 'ck', 'c.k', 'c.k.'],
  louisvuitton: ['louis vuitton', 'louis', 'vuitton', 'lv', 'l.v', 'l.v.'],
  lv: ['louis vuitton', 'louis', 'vuitton', 'lv', 'l.v', 'l.v.'],
  'l.v': ['louis vuitton', 'louis', 'vuitton', 'lv', 'l.v', 'l.v.'],
  nike: ['nike', 'nikke', 'nyke'],
  tommy: ['tommy', 'tomy', 'tommi', 'tommy hilfiger'],
  zara: ['zara', 'zarra'],
  diesel: ['diesel', 'disel', 'deejal'],
  stussy: ['stussy', 'stusy', 'stussi'],
  bonkers: ['bonkers', 'bonker'],
  lacoste: ['lacoste', 'lacost'],
  polo: ['polo', 'ralph lauren', 'polo ralph lauren'],
  armani: ['armani', 'ea7', 'emporio armani'],
  carhartt: ['carhartt', 'carhart'],
  coach: ['coach'],
  represent: ['represent'],
  northface: ['north face', 'northface', 'tnf'],
  scuffers: ['scuffers', 'scuffer'],
  youngla: ['youngla', 'young la', 'young-la'],
  qc: ['qc', 'qc jacket'],
  bottega: ['bottega veneta', 'bottega', 'bv'],
  acne: ['acne studios', 'acne studio', 'acne'],
  amiri: ['amiri', 'ameeri'],
  myshelter: ['myshelter', 'my shelter', 'shelter'],
  washcare: ['washcare', 'wash care', 'wash-care'],
  flower: ['flower', 'flor']
};

/**
 * Expands any word or search term into all its fuzzy variants:
 * 1. Exact term
 * 2. Brand synonym aliases
 * 3. Collapsed duplicate consonants (e.g. addidas -> adidas, channal -> chanal)
 * 4. Expanded single-to-double consonants (e.g. adidas -> addidas)
 * 5. Dot variations (e.g. c.k <-> ck)
 */
export function expandFuzzySearchVariants(term) {
  if (!term || typeof term !== 'string') return [];
  const raw = term.toLowerCase().trim();
  const variants = new Set();
  variants.add(raw);

  // 1. Direct synonym lookup
  for (const [canonical, aliases] of Object.entries(BRAND_SYNONYMS)) {
    if (raw === canonical || aliases.includes(raw) || aliases.some(a => raw.includes(a))) {
      aliases.forEach(a => variants.add(a));
      variants.add(canonical);
    }
  }

  // 2. Consecutive duplicate letter collapse (e.g. addidas -> adidas, channal -> chanal)
  const collapsed = raw.replace(/(.)\1+/g, '$1');
  variants.add(collapsed);

  for (const [canonical, aliases] of Object.entries(BRAND_SYNONYMS)) {
    if (collapsed === canonical || aliases.includes(collapsed)) {
      aliases.forEach(a => variants.add(a));
      variants.add(canonical);
    }
  }

  // 3. Double common consonants (e.g. adidas -> addidas, chanel -> channal)
  const commonConsonants = ['d', 'l', 'n', 'r', 's', 't', 'p', 'b', 'c', 'm'];
  for (const c of commonConsonants) {
    if (raw.includes(c) && !raw.includes(c + c)) {
      variants.add(raw.replace(new RegExp(c, 'g'), c + c));
    }
  }

  // 4. Dot variations for acronyms: c.k <-> ck, l.v <-> lv
  if (raw.includes('.')) {
    variants.add(raw.replace(/\./g, ''));
  } else if (raw.length === 2) {
    variants.add(raw[0] + '.' + raw[1]);
    variants.add(raw[0] + '.' + raw[1] + '.');
  }

  return Array.from(variants).filter(v => v.length >= 2);
}

/**
 * Standard Levenshtein Distance for typo tolerance
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Smart fuzzy string matcher:
 * Checks direct substring, expanded variants, collapsed duplicates, and Levenshtein token distance.
 */
export function isFuzzyMatch(targetText, queryToken, maxDist = 2) {
  if (!targetText || !queryToken) return false;
  const normTarget = String(targetText).toLowerCase();
  const normQuery = String(queryToken).toLowerCase().trim();

  // 1. Direct substring
  if (normTarget.includes(normQuery)) return true;

  // 2. Check all expanded fuzzy variants
  const variants = expandFuzzySearchVariants(normQuery);
  for (const v of variants) {
    if (normTarget.includes(v)) return true;
  }

  // 3. Collapsed duplicate letters
  const colTarget = normTarget.replace(/(.)\1+/g, '$1');
  const colQuery = normQuery.replace(/(.)\1+/g, '$1');
  if (colTarget.includes(colQuery) || colQuery.includes(colTarget)) return true;

  // 4. Token-by-token Levenshtein distance
  const words = normTarget.split(/[\s\-_(),.]+/).filter(Boolean);
  for (const w of words) {
    if (w.length >= 3 && Math.abs(w.length - normQuery.length) <= 2) {
      if (levenshteinDistance(w, normQuery) <= (normQuery.length <= 4 ? 1 : maxDist)) {
        return true;
      }
    }
    const colW = w.replace(/(.)\1+/g, '$1');
    if (colW.length >= 3 && levenshteinDistance(colW, colQuery) <= 1) {
      return true;
    }
  }

  return false;
}

/**
 * 1. WEIGHT CAPTURE QUERIES
 */
export async function getWeightCaptureByLot(lotNo) {
  const clean = cleanLot(lotNo);
  if (!clean) return [];

  try {
    const rows = await accessoryQuery(
      `SELECT * FROM weight_capture 
       WHERE TRIM(LOWER(lotNo)) = TRIM(LOWER(?)) 
          OR TRIM(LOWER(lotNo)) LIKE TRIM(LOWER(?))
       ORDER BY capturedAt DESC, id DESC`,
      [clean, `%${clean}%`]
    );
    return rows || [];
  } catch (err) {
    console.warn(`[Accessory Service] Error querying weight capture for Lot ${lotNo}:`, err.message);
    return [];
  }
}

export async function getRecentWeightCaptures(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM weight_capture ORDER BY capturedAt DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying recent weight captures:', err.message);
    return [];
  }
}

export async function getWeightCaptureSummary() {
  try {
    const [summary] = await accessoryQuery(`
      SELECT 
        COUNT(*) as totalEntries,
        COUNT(DISTINCT lotNo) as distinctLots,
        ROUND(COALESCE(SUM(grossWeightKg), 0), 2) as totalGrossKg,
        ROUND(COALESCE(SUM(netWeightKg), 0), 2) as totalNetKg,
        COALESCE(SUM(pieces), 0) as totalPieces,
        COALESCE(SUM(packets), 0) as totalPackets,
        SUM(CASE WHEN LOWER(approvalStatus) = 'approved' THEN 1 ELSE 0 END) as approvedCount,
        SUM(CASE WHEN LOWER(approvalStatus) = 'pending' OR approvalStatus IS NULL THEN 1 ELSE 0 END) as pendingCount
      FROM weight_capture
    `);
    return summary || null;
  } catch (err) {
    console.warn('[Accessory Service] Error querying weight capture summary:', err.message);
    return null;
  }
}

/**
 * 2. ISSUE LOGS QUERIES
 */
export async function getIssueLogsByLot(lotId) {
  const clean = cleanLot(lotId);
  if (!clean) return [];

  try {
    const rows = await accessoryQuery(
      `SELECT * FROM issue_logs 
       WHERE TRIM(LOWER(lotId)) = TRIM(LOWER(?)) 
          OR TRIM(LOWER(lotId)) LIKE TRIM(LOWER(?))
       ORDER BY date DESC, id DESC`,
      [clean, `%${clean}%`]
    );

    return (rows || []).map(r => ({
      ...r,
      parsedMaterials: safeParseJson(r.materials, r.materials)
    }));
  } catch (err) {
    console.warn(`[Accessory Service] Error querying issue logs for Lot ${lotId}:`, err.message);
    return [];
  }
}

export async function getRecentIssueLogs(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM issue_logs ORDER BY date DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return (rows || []).map(r => ({
      ...r,
      parsedMaterials: safeParseJson(r.materials, r.materials)
    }));
  } catch (err) {
    console.warn('[Accessory Service] Error querying recent issue logs:', err.message);
    return [];
  }
}

/**
 * Search Issue Logs by material name, category, receiver, lotId, or keyword
 */
export async function searchIssueLogs(query = '', options = {}) {
  const { limit = 50, lotId: forcedLotId = null, receiver: forcedReceiver = null } = options;
  try {
    const lower = (query || '').toLowerCase().trim();

    // 1. Direct Lot ID filter
    let lotId = forcedLotId;
    if (!lotId && lower) {
      const lotMatch = lower.match(/\b(?:lot\s*(?:no\.?|#)?\s*)(\d{3,6})\b/i) || lower.match(/\b(\d{5})\b/);
      if (lotMatch) lotId = lotMatch[1].trim();
    }

    // 2. Extract Category (e.g. label, tag, dori, patch, button, zip, polybeg, etc.)
    let categoryTerm = null;
    if (lower) {
      const catMatch = lower.match(/\b(labels?|tags?|doris?|dooris?|patch(?:es)?|matel\s*patch|buttons?|zips?|zippers?|polybegs?|polybags?|begs?|tapes?|inners?|elastics?|cuffs?|washcare|stoppers?|pasting|ribit|ribbit|rivets?|eyelets?|i\.?let|fashion\s*patti|patti|spray|washal)\b/i);
      if (catMatch) categoryTerm = catMatch[1].replace(/s$/, '').replace(/es$/, '');
    }

    // 3. Extract Brand from query
    const knownBrands = [
      'amiri', 'nike jacket', 'nike', 'tommy', 'zara', 'addidas brick jacket myshelter',
      'addidas tag brick', 'addidas brick', 'addidas flower jacket', 'addidas flower',
      'addidas', 'adidas', 'lacoste jacket', 'lacoste', 'polo jacket', 'polo', 'armani', 'carhartt',
      'coach jacket', 'coach', 'diesel shirt', 'diesel', 'herms', 'represent',
      'north face', 'trapster', 'edge', 'scuffers', 'channal', 'burburry',
      'burbour jacket inner', 'loropiane', 'youngla', 'qc jacket', 'qc', 'fear of god',
      'essentinal  jacket', 'essentinal', 'essentials', 'stussy', 'bonkers', 'bottega veneta',
      'acne studio', 'hacket', 'c.k', 'barbour', 'l.v'
    ];
    let brandMatch = null;
    if (lower) {
      brandMatch = knownBrands.find(b => lower.includes(b));
    }

    // 4. Extract Receiver from query
    const knownReceivers = [
      'karan', 'monu', 'gyaninder', 'pooja', 'pintu', 'sonu', 'sanjay',
      'chavinath', 'yuvraj', 'ram chander', 'ramchander', 'parmod', 'shriwast', 'kamal', 'mithlash', 'mitlash'
    ];
    let receiverMatch = forcedReceiver;
    if (!receiverMatch && lower) {
      receiverMatch = knownReceivers.find(r => lower.includes(r));
    }

    // 4b. Extract Department (e.g. cutting, stitching, packing, finishing, iron)
    const knownDepts = ['cutting', 'stitching', 'packing', 'finishing', 'iron'];
    let deptMatch = null;
    if (lower) {
      deptMatch = knownDepts.find(d => lower.includes(d));
    }

    let sql = `SELECT * FROM issue_logs WHERE 1=1`;
    const params = [];

    if (lotId) {
      sql += ` AND (LOWER(lotId) = LOWER(?) OR LOWER(lotId) LIKE LOWER(?))`;
      params.push(cleanLot(lotId), `%${cleanLot(lotId)}%`);
    }

    if (receiverMatch) {
      sql += ` AND (LOWER(receiverName) LIKE LOWER(?) OR LOWER(receiverDept) LIKE LOWER(?))`;
      params.push(`%${receiverMatch}%`, `%${receiverMatch}%`);
    }

    if (deptMatch) {
      sql += ` AND (LOWER(receiverDept) LIKE LOWER(?) OR LOWER(receiverName) LIKE LOWER(?))`;
      params.push(`%${deptMatch}%`, `%${deptMatch}%`);
    }

    if (brandMatch) {
      const brandVars = expandFuzzySearchVariants(brandMatch);
      const brandClauses = brandVars.map(() => `LOWER(materials) LIKE LOWER(?)`);
      sql += ` AND (${brandClauses.join(' OR ')})`;
      brandVars.forEach(v => params.push(`%${v}%`));
    }

    if (categoryTerm) {
      sql += ` AND (LOWER(materials) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?))`;
      params.push(`%${categoryTerm}%`, `%${categoryTerm}%`);
    }

    // If neither brand, category, receiver, nor lot were detected, fallback to keyword search
    if (!lotId && !receiverMatch && !brandMatch && !categoryTerm && query && query.trim()) {
      const stopWords = new Set([
        'sry', 'sorry', 'ab', 'tk', 'tak', 'kis', 'kisko', 'kisne', 'kise', 'or', 'aur', 
        'k', 'ke', 'ki', 'ka', 'ko', 'against', 'issue', 'issued', 'issuance', 'kara', 
        'kra', 'kare', 'kiya', 'hua', 'hai', 'h', 'tha', 'the', 'thi', 'mre', 
        'mere', 'pass', 'with', 'photo', 'photos', 'total', 'details', 'detail', 'batao', 
        'btana', 'dikhao', 'check', 'karo', 'karna', 'kariye', 'please', 'plz', 'record', 
        'records', 'logs', 'log', 'history', 'btao', 'lot', 'lots', 'item', 'items', 'sirf',
        'kya', 'kyu', 'kaun', 'kaunse', 'kab', 'kaha', 'kaise', 'kitna', 'kitne', 'kitni',
        'gya', 'gaya', 'gaye', 'gayi', 'hue', 'hui', 'par', 'pe', 'se', 'me', 'mein',
        'diye', 'diya', 'liya', 'liye', 'kuch', 'bhi', 'abtak', 'abhi', 'abhitak',
        'sara', 'saara', 'sare', 'saare', 'sari', 'saari', 'sarra', 'sarre', 'sarri',
        'sab', 'sabhi', 'sbhi', 'sb', 'pura', 'pure', 'puri', 'poora', 'poore', 'poori',
        'tamam', 'har', 'harek', 'kul', 'kull', 'complete', 'entire', 'full', 'whole'
      ]);
      const words = lower.split(/[\s,]+/).filter(w => w.length > 1 && !stopWords.has(w));
      if (words.length > 0) {
        words.forEach(w => {
          sql += ` AND (LOWER(materials) LIKE LOWER(?) OR LOWER(lotId) LIKE LOWER(?) OR LOWER(receiverName) LIKE LOWER(?) OR LOWER(receiverDept) LIKE LOWER(?) OR LOWER(personName) LIKE LOWER(?))`;
          params.push(`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`);
        });
      }
    }

    sql += ` ORDER BY date DESC, id DESC LIMIT ?`;
    params.push(Number(limit) || 50);

    const rows = await accessoryQuery(sql, params);
    return (rows || []).map(r => ({
      ...r,
      parsedMaterials: safeParseJson(r.materials, r.materials)
    }));
  } catch (err) {
    console.warn('[Accessory Service] Error searching issue logs:', err.message);
    return [];
  }
}

/**
 * 3. MATERIALS / INVENTORY QUERIES
 */
export async function getMaterialsInventory(options = {}) {
  const { search, category, lowStockOnly, limit = 100 } = options;

  try {
    let sql = `SELECT * FROM materials WHERE 1=1`;
    const params = [];

    if (category) {
      sql += ` AND LOWER(category) = LOWER(?)`;
      params.push(category);
    }

    if (search) {
      const variants = expandFuzzySearchVariants(search);
      const searchClauses = [];
      for (const v of variants) {
        const term = `%${v}%`;
        searchClauses.push(`(
          LOWER(name) LIKE ? 
          OR LOWER(id) LIKE ? 
          OR LOWER(COALESCE(brand, '')) LIKE ? 
          OR LOWER(COALESCE(itemCode, '')) LIKE ? 
          OR LOWER(COALESCE(category, '')) LIKE ? 
          OR LOWER(COALESCE(color, '')) LIKE ? 
          OR LOWER(COALESCE(location, '')) LIKE ?
        )`);
        params.push(term, term, term, term, term, term, term);
      }
      sql += ` AND (${searchClauses.join(' OR ')})`;
    }

    if (lowStockOnly) {
      sql += ` AND stock <= threshold`;
    }

    sql += ` ORDER BY category ASC, stock DESC LIMIT ?`;
    params.push(Number(limit) || 100);

    const rows = await accessoryQuery(sql, params);
    if (rows && rows.length > 0) return rows;

    // Fallback: If search was provided and returned 0 rows from SQL,
    // load broader list and perform deep fuzzy string matching
    if (search && (!rows || rows.length === 0)) {
      let fallbackSql = `SELECT * FROM materials WHERE 1=1`;
      const fallbackParams = [];
      if (category) {
        fallbackSql += ` AND LOWER(category) = LOWER(?)`;
        fallbackParams.push(category);
      }
      fallbackSql += ` ORDER BY stock DESC LIMIT 300`;
      const allRows = await accessoryQuery(fallbackSql, fallbackParams);
      if (allRows && allRows.length > 0) {
        const fuzzyMatched = allRows.filter(r =>
          isFuzzyMatch(r.name, search) ||
          isFuzzyMatch(r.brand, search) ||
          isFuzzyMatch(r.category, search) ||
          isFuzzyMatch(r.itemCode, search)
        );
        if (fuzzyMatched.length > 0) return fuzzyMatched;
      }
    }

    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying materials inventory:', err.message);
    return [];
  }
}

export async function searchMaterialsByNameOrCode(term) {
  if (!term) return [];
  return getMaterialsInventory({ search: term, limit: 30 });
}

/**
 * Smart Multi-Token Search for materials, brands, categories, tags, labels with Cloudinary images
 */
export async function searchAccessoryMaterialsSmart(queryStr, options = {}) {
  const raw = String(queryStr || '').trim();
  if (!raw) return [];

  const lower = raw.toLowerCase();

  // 1. Identify common accessory categories
  const isTag = /\b(tags?)\b/i.test(lower);
  const isLabel = /\b(labels?)\b/i.test(lower);
  const isPatch = /\b(patch(?:es)?|matel\s*patch)\b/i.test(lower);
  const isButton = /\b(buttons?)\b/i.test(lower);
  const isTape = /\b(tapes?)\b/i.test(lower);
  const isDori = /\b(dori|doori)\b/i.test(lower);
  const isBone = /\b(bones?)\b/i.test(lower);
  const isPolybag = /\b(poly\s*begs?|poly\s*bags?|polybegs?|polybags?|polbegs?|polbags?|lifaf(?:a|e|aa)?|packing\s*(?:beg|bag)s?|begs?)\b/i.test(lower);
  const isElastic = /\b(elastics?)\b/i.test(lower);
  const isStopper = /\b(stoppers?)\b/i.test(lower);
  const isSpray = /\b(spray|sprays)\b/i.test(lower);
  const isRivet = /\b(ribit|ribbit|rivets?)\b/i.test(lower);
  const isPasting = /\b(pasting)\b/i.test(lower);
  const isInner = /\b(inners?)\b/i.test(lower);
  const isCuff = /\b(cuffs?)\b/i.test(lower);
  const isEyelet = /\b(eyelets?|i\.?let)\b/i.test(lower);
  const isFashionPatti = /\b(fashion\s*patti|patti|soft\s*patti)\b/i.test(lower);
  const isWashal = /\b(washal)\b/i.test(lower);

  // Extract non-category keywords (to check if a specific brand/item is requested, e.g. "amiri tag" vs "total tag")
  const stopWords = new Set([
    'k', 'ke', 'ka', 'ki', 'ko', 'me', 'mein', 'mre', 'mere', 'mera', 'meri', 'mra', 'merko', 'mereko', 'mujhe', 'mujhko',
    'pass', 'paas', 'pas', 'hamare', 'humare', 'hamara', 'humara', 'hamari', 'humari', 'hume', 'humko', 'apne', 'apna', 'apni',
    'kitna', 'kitne', 'kitni', 'pda', 'pada', 'pde', 'pade', 'pdi', 'padi', 'padaa', 'pdaa', 'bacha', 'bache', 'bachi', 'rakha', 'rakhe', 'rakhi',
    'hai', 'h', 'hain', 'tha', 'the', 'thi', 'hua', 'hue', 'hui', 'hoga', 'hoge', 'hogi',
    'with', 'photo', 'photos', 'image', 'images', 'pic', 'pics', 'picture', 'tasveer', 'tasvir',
    'dikhao', 'dikhana', 'batao', 'btana', 'btao', 'bataiye', 'show', 'tell', 'available', 'check', 'karo', 'krdo', 'kariye', 'dekho', 'dekhna', 'bhejo',
    'please', 'plz', 'total', 'all', 'sab', 'sabhi', 'sbhi', 'sb',
    'sara', 'saara', 'sare', 'saare', 'sari', 'saari', 'sarra', 'sarre', 'sarri',
    'pura', 'pure', 'puri', 'poora', 'poore', 'poori',
    'tamam', 'har', 'harek', 'kul', 'kull', 'complete', 'entire', 'full', 'whole',
    'detail', 'details', 'stock', 'inventory', 
    'godown', 'rack', 'location', 'maal', 'saman', 'kya', 'kaha', 'kahan', 'kuch', 'koi', 'bhi', 'sirf',
    'tag', 'tags', 'label', 'labels', 'patch', 'patches', 'button', 'buttons',
    'tape', 'tapes', 'dori', 'doori', 'bone', 'polybeg', 'polybag', 'polbeg', 'beg', 'lifafa', 'lifafe', 'elastic', 'stopper', 'spray', 'trims', 'accessory', 'accessories',
    'store', 'warehouse', 'factory', 'floor', 'room', 'karkhana', 'karkhane', 'konsa', 'konse', 'konsi', 'abhi', 'abtak', 'abhitak', 'aaj', 'kal', 'parso',
    'uncut', 'un-cut', 'cut', 'cutting', 'lots', 'lot', 'order', 'orders', 'pending', 'party', 'buyer', 'bina', 'kate', 'kahan', 'tak', 'pahuncha', 'pahucha'
  ]);
  const hasCategory = (isTag || isLabel || isPatch || isButton || isTape || isDori || isBone || isPolybag || isElastic || isStopper || isSpray || isRivet || isPasting || isInner || isCuff || isEyelet || isFashionPatti || isWashal);
  const partyAcronyms = new Set(['ss', 'db', 'bb', 'mh']);
  const brandTokens = lower.replace(/[^a-z0-9\s_-]/g, ' ').split(/\s+/).filter(t => {
    if (t.length < 2 || stopWords.has(t)) return false;
    if (/^\d+(\.\d+)?$/.test(t)) return false;
    if (partyAcronyms.has(t) && !hasCategory) return false;
    return true;
  });

  try {
    // Case A.0: Specific Godown Rack inquiry (e.g. "rack 54 me kya hai", "rack 92", "rack no 1")
    const rackMatch = lower.match(/\b(?:rack|rk)\s*(?:no\.?|#)?\s*([0-9a-z_-]+)\b/i);
    if (rackMatch && !isTag && !isLabel && !isPatch && !isButton) {
      const rackNo = rackMatch[1].trim();
      const rackSql = `SELECT * FROM materials WHERE LOWER(location) LIKE ? ORDER BY stock DESC LIMIT 100`;
      const rackRows = await accessoryQuery(rackSql, [`%rack ${rackNo}%`]);
      if (rackRows && rackRows.length > 0) return rackRows;
      const rackRows2 = await accessoryQuery(rackSql, [`%${rackNo}%`]);
      if (rackRows2 && rackRows2.length > 0) return rackRows2;
    }

    // Case A.1: Query is for an entire category (with or without a specific brand)
    if (isTag || isLabel || isPatch || isButton || isTape || isDori || isBone || isPolybag || isElastic || isStopper || isSpray || isRivet || isPasting || isInner || isCuff || isEyelet || isFashionPatti || isWashal) {
      let catClauses = [];
      let catParams = [];

      // Detect polybag size if applicable (e.g. "16/26", "12/16", "12.5/17", "14x20", "22/36")
      const polySizeMatch = isPolybag ? lower.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:\/|\s*x\s*|-|\s+)\s*(\d{1,2}(?:\.\d+)?)\b/) : null;
      let polySizeClauses = [];
      let polySizeParams = [];
      if (polySizeMatch) {
        const s1 = `${polySizeMatch[1]}/${polySizeMatch[2]}`;
        const s2 = `${polySizeMatch[1]} / ${polySizeMatch[2]}`;
        const s3 = `${polySizeMatch[1]}x${polySizeMatch[2]}`;
        const s4 = `${polySizeMatch[1]} x ${polySizeMatch[2]}`;
        polySizeClauses.push('(LOWER(name) LIKE ? OR LOWER(name) LIKE ? OR LOWER(name) LIKE ? OR LOWER(name) LIKE ?)');
        polySizeParams.push(`%${s1}%`, `%${s2}%`, `%${s3}%`, `%${s4}%`);
      }

      if (isTag) {
        catClauses.push('LOWER(category) IN (?, ?)');
        catParams.push('tags', 'tag');
      }
      if (isLabel) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%label%');
      }
      if (isPatch) {
        catClauses.push('(LOWER(category) LIKE ? OR LOWER(category) LIKE ?)');
        catParams.push('%patch%', '%matel patch%');
      }
      if (isButton) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%button%');
      }
      if (isTape) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%tape%');
      }
      if (isDori) {
        catClauses.push('(LOWER(category) LIKE ? OR LOWER(category) LIKE ? OR LOWER(name) LIKE ?)');
        catParams.push('%dori%', '%doori%', '%dori%');
      }
      if (isBone) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%bone%');
      }
      if (isPolybag) {
        let pSql = `(
          (LOWER(category) LIKE ? OR LOWER(category) LIKE ? OR LOWER(category) LIKE ? OR LOWER(name) LIKE ? OR LOWER(name) LIKE ?)
          AND LOWER(name) NOT LIKE '%polyster%'
        )`;
        catParams.push('%polybeg%', '%polybag%', '%beg%', '%poly%', '%polbeg%');
        if (polySizeClauses.length > 0) {
          pSql += ` AND ${polySizeClauses.join(' AND ')}`;
          catParams.push(...polySizeParams);
        }
        catClauses.push(pSql);
      }
      if (isElastic) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%elastic%');
      }
      if (isStopper) {
        catClauses.push('(LOWER(category) LIKE ? OR LOWER(name) LIKE ?)');
        catParams.push('%stopper%', '%stopper%');
      }
      if (isSpray) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%spray%');
      }
      if (isRivet) {
        catClauses.push('(LOWER(category) LIKE ? OR LOWER(category) LIKE ?)');
        catParams.push('%ribit%', '%ribbit%');
      }
      if (isPasting) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%pasting%');
      }
      if (isInner) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%inner%');
      }
      if (isCuff) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%cuff%');
      }
      if (isEyelet) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%let%');
      }
      if (isFashionPatti) {
        catClauses.push('(LOWER(category) LIKE ? OR LOWER(category) LIKE ?)');
        catParams.push('%patti%', '%fashion patti%');
      }
      if (isWashal) {
        catClauses.push('LOWER(category) LIKE ?');
        catParams.push('%washal%');
      }

      // If a brand token was also present (e.g. "amiri tag", "adidas label"), filter by that brand as well
      if (brandTokens.length > 0) {
        let brandConditions = [];
        let brandParams = [];
        for (const bt of brandTokens) {
          const variants = expandFuzzySearchVariants(bt);
          for (const v of variants) {
            brandConditions.push('(LOWER(name) LIKE ? OR LOWER(COALESCE(brand, "")) LIKE ? OR LOWER(COALESCE(itemCode, "")) LIKE ?)');
            const pVal = `%${v}%`;
            brandParams.push(pVal, pVal, pVal);
          }
        }
        const sql = `SELECT * FROM materials WHERE (${catClauses.join(' OR ')}) AND (${brandConditions.join(' OR ')}) ORDER BY stock DESC LIMIT 200`;
        const brandRows = await accessoryQuery(sql, [...catParams, ...brandParams]);
        if (brandRows && brandRows.length > 0) return brandRows;

        // If specific brand was asked with this category, but has 0 items in this category:
        // Check if that brand exists in OTHER categories (e.g. user asks "amiri label" -> returns AMIRI Tags & Patch)
        const anyBrandSql = `SELECT * FROM materials WHERE (${brandConditions.join(' OR ')}) ORDER BY stock DESC LIMIT 50`;
        const anyBrandRows = await accessoryQuery(anyBrandSql, brandParams);
        if (anyBrandRows && anyBrandRows.length > 0) {
          return anyBrandRows;
        }

        // Try in-memory fuzzy match across all category items
        const catSqlFallback = `SELECT * FROM materials WHERE (${catClauses.join(' OR ')}) ORDER BY stock DESC LIMIT 300`;
        const allCatRowsFallback = await accessoryQuery(catSqlFallback, catParams);
        if (allCatRowsFallback && allCatRowsFallback.length > 0) {
          const fuzzyMatches = allCatRowsFallback.filter(r =>
            brandTokens.some(bt => isFuzzyMatch(r.name, bt) || isFuzzyMatch(r.brand, bt) || isFuzzyMatch(r.itemCode, bt))
          );
          if (fuzzyMatches.length > 0) return fuzzyMatches;
          return allCatRowsFallback;
        }
        return [];
      }

      // If no specific brand or brand matched nothing, return ALL items for this category!
      const catSql = `SELECT * FROM materials WHERE (${catClauses.join(' OR ')}) ORDER BY stock DESC LIMIT 300`;
      const allCatRows = await accessoryQuery(catSql, catParams);
      if (allCatRows && allCatRows.length > 0) return allCatRows;
    }

    // Case B: General Brand / Item Name search (e.g. "amiri", "brooks brothers", "adidas", "addidas", "ST00001")
    let rows = await getMaterialsInventory({ search: raw, limit: options.limit || 100 });
    if (rows && rows.length > 0) return rows;

    for (const token of brandTokens) {
      const candidate = await getMaterialsInventory({ search: token, limit: 100 });
      if (candidate && candidate.length > 0) return candidate;
    }

    // Broad catalog fallback with deep fuzzy scoring
    const allMaterials = await accessoryQuery(`SELECT * FROM materials ORDER BY stock DESC LIMIT 300`);
    if (allMaterials && allMaterials.length > 0) {
      const matched = allMaterials.filter(r =>
        brandTokens.some(bt => isFuzzyMatch(r.name, bt) || isFuzzyMatch(r.brand, bt) || isFuzzyMatch(r.category, bt) || isFuzzyMatch(r.itemCode, bt))
      );
      if (matched.length > 0) return matched;
    }
  } catch (err) {
    console.warn('[Accessory Service] Error in smart search:', err.message);
  }

  return [];
}

export async function getLowStockMaterials() {
  return getMaterialsInventory({ lowStockOnly: true, limit: 50 });
}

/**
 * 4. ZIP & DORI (TRIMS) QUERIES
 */
export async function getTrimsByLot(lotNo) {
  const clean = cleanLot(lotNo);
  if (!clean) return { zips: [], doris: [] };

  try {
    const zips = await accessoryQuery(
      `SELECT * FROM zip WHERE TRIM(LOWER(Lot_Number)) = TRIM(LOWER(?)) OR TRIM(LOWER(Lot_Number)) LIKE TRIM(LOWER(?)) ORDER BY id DESC`,
      [clean, `%${clean}%`]
    ).catch(() => []);

    const doris = await accessoryQuery(
      `SELECT * FROM doori WHERE TRIM(LOWER(Lot_Number)) = TRIM(LOWER(?)) OR TRIM(LOWER(Lot_Number)) LIKE TRIM(LOWER(?)) ORDER BY id DESC`,
      [clean, `%${clean}%`]
    ).catch(() => []);

    return { zips: zips || [], doris: doris || [] };
  } catch (err) {
    console.warn(`[Accessory Service] Error querying trims for Lot ${lotNo}:`, err.message);
    return { zips: [], doris: [] };
  }
}

/**
 * 5. GODOWN / WAREHOUSE MATERIAL TRANSFERS
 */
export async function getMaterialTransfers(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM material_transfers ORDER BY transferredAt DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying material transfers:', err.message);
    return [];
  }
}

/**
 * 6. RETURNABLE GATE PASSES (RGP)
 */
export async function getAccessoryRgpList(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM rgp ORDER BY createdAt DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return (rows || []).map(r => ({
      ...r,
      parsedEntries: safeParseJson(r.entries, [])
    }));
  } catch (err) {
    console.warn('[Accessory Service] Error querying RGP passes:', err.message);
    return [];
  }
}

/**
 * 7. INWARD BARCODE SCANS
 */
export async function getAccessoryScans(limit = 20) {
  try {
    const rows = await accessoryQuery(
      `SELECT * FROM scans ORDER BY scanned_at DESC, id DESC LIMIT ?`,
      [Number(limit) || 20]
    );
    return rows || [];
  } catch (err) {
    console.warn('[Accessory Service] Error querying accessory scans:', err.message);
    return [];
  }
}

/**
 * 8. MASTER CONSOLIDATED LOT ACCESSORY INTELLIGENCE
 */
export async function getCompleteAccessoryReportForLot(lotNo) {
  const clean = cleanLot(lotNo);
  if (!clean) return null;

  const [weightRecords, issueLogs, trims, rgps, scans] = await Promise.all([
    getWeightCaptureByLot(clean),
    getIssueLogsByLot(clean),
    getTrimsByLot(clean),
    getAccessoryRgpList(50).then(list => list.filter(r => {
      const matchInEntries = (r.parsedEntries || []).some(e => String(e.lotNo || '') === clean);
      return matchInEntries || String(r.remarks || '').includes(clean);
    })).catch(() => []),
    accessoryQuery(`SELECT * FROM scans WHERE TRIM(LOWER(lot_number)) = TRIM(LOWER(?)) ORDER BY scanned_at DESC`, [clean]).catch(() => [])
  ]);

  const hasData = (weightRecords.length > 0) || (issueLogs.length > 0) ||
                  (trims.zips.length > 0) || (trims.doris.length > 0) ||
                  (rgps.length > 0) || (scans.length > 0);

  // Calculate metrics
  const totalVerifiedWeightKg = weightRecords.reduce((acc, r) => acc + (Number(r.netWeightKg) || 0), 0);
  const totalVerifiedPieces = weightRecords.reduce((acc, r) => acc + (Number(r.pieces) || 0), 0);
  const totalPackets = weightRecords.reduce((acc, r) => acc + (Number(r.packets) || 0), 0);
  const isAllApproved = weightRecords.length > 0 && weightRecords.every(r => (r.approvalStatus || '').toLowerCase() === 'approved');

  return {
    lotNo: clean,
    hasData,
    connected: isAccessoryConnected(),
    metrics: {
      weightEntriesCount: weightRecords.length,
      totalVerifiedWeightKg: Math.round(totalVerifiedWeightKg * 1000) / 1000,
      totalVerifiedPieces,
      totalPackets,
      isAllApproved,
      issueLogsCount: issueLogs.length,
      zipOrdersCount: trims.zips.length,
      doriOrdersCount: trims.doris.length,
      rgpCount: rgps.length,
      scanCount: scans.length
    },
    weightRecords,
    issueLogs,
    zips: trims.zips,
    doris: trims.doris,
    rgps,
    scans
  };
}

/**
 * 9. COMPREHENSIVE ACCESSORY STORAGE OVERVIEW WITH SOLUTIONS
 */
export async function getAccessoryStorageOverview() {
  if (!isAccessoryConnected()) {
    await initAccessoryDatabase().catch(() => {});
  }

  const [allMaterials, weightSummary, recentWeights, recentTransfers, recentRgps, recentScans, trimsCount] = await Promise.all([
    getMaterialsInventory({ limit: 200 }),
    getWeightCaptureSummary(),
    getRecentWeightCaptures(10),
    getMaterialTransfers(10),
    getAccessoryRgpList(10),
    getAccessoryScans(10),
    accessoryQuery(`
      SELECT 
        (SELECT COUNT(*) FROM zip) as zipCount,
        (SELECT COUNT(*) FROM doori) as dooriCount,
        (SELECT COUNT(*) FROM dori_issue) as doriIssueCount
    `).catch(() => [[{ zipCount: 0, dooriCount: 0, doriIssueCount: 0 }]])
  ]);

  const dbStatus = getAccessoryDbStatus();
  const connected = isAccessoryConnected();

  const tc = trimsCount?.[0] || {};
  const totalZips = Number(tc.zipCount) || 0;
  const totalDoris = Math.max(Number(tc.dooriCount) || 0, Number(tc.doriIssueCount) || 0);

  // Materials analysis
  const totalMaterials = allMaterials.length;
  const totalStockQty = allMaterials.reduce((acc, m) => acc + (Number(m.stock) || 0), 0);
  const lowStockItems = allMaterials.filter(m => {
    const s = Number(m.stock);
    const th = Number(m.threshold);
    return !isNaN(s) && !isNaN(th) && s <= th;
  });

  const categoriesMap = {};
  const locationsMap = {};
  allMaterials.forEach(m => {
    const cat = m.category || 'Other';
    categoriesMap[cat] = (categoriesMap[cat] || 0) + 1;
    const loc = m.location || 'Main Godown';
    locationsMap[loc] = (locationsMap[loc] || 0) + 1;
  });

  // Actionable Solutions Generator
  const solutions = [];

  // Solution 1: Low Stock Replenishment
  if (lowStockItems.length > 0) {
    solutions.push({
      type: 'RESTOCK_ALERT',
      severity: 'HIGH',
      title: `Critical Re-order Alert for ${lowStockItems.length} Materials`,
      summary: `${lowStockItems.length} accessory items have reached or breached threshold levels.`,
      action: 'Generate purchase orders to prevent stitching line starvation.',
      items: lowStockItems.slice(0, 5).map(m => ({
        id: m.id,
        name: m.name,
        stock: m.stock,
        threshold: m.threshold,
        unit: m.unit,
        location: m.location
      }))
    });
  } else {
    solutions.push({
      type: 'STOCK_HEALTH',
      severity: 'NORMAL',
      title: 'Healthy Stock Buffer',
      summary: 'All registered accessory materials are above critical threshold limits.',
      action: 'Continue periodic stock audit.'
    });
  }

  // Solution 2: Weight Verification Quality & Approvals
  if (weightSummary && weightSummary.pendingCount > 0) {
    solutions.push({
      type: 'APPROVAL_REQUIRED',
      severity: 'MEDIUM',
      title: `${weightSummary.pendingCount} Weight Captures Pending Quality Sign-Off`,
      summary: 'Weight scale entries recorded but pending formal QA approval.',
      action: 'Review and approve digital weight logs in the accessory portal.'
    });
  } else if (weightSummary && weightSummary.totalEntries > 0) {
    solutions.push({
      type: 'WEIGHT_VERIFIED',
      severity: 'NORMAL',
      title: 'Digital Scale Integration 100% Operational',
      summary: `${weightSummary.totalEntries} entries logged totaling ${weightSummary.totalNetKg} kg net with 100% QA verified status.`,
      action: 'Tare weight calibration is healthy.'
    });
  }

  // Solution 3: RGP Vendor Return Tracking
  const pendingRgps = recentRgps.filter(r => r.expectedReturnDate && new Date(r.expectedReturnDate) <= new Date());
  if (pendingRgps.length > 0) {
    solutions.push({
      type: 'RGP_OVERDUE',
      severity: 'MEDIUM',
      title: `${pendingRgps.length} Returnable Gate Passes Due for Recovery`,
      summary: 'Materials sent to external stitching/embroidery vendors have reached expected return date.',
      action: 'Follow up with vendor to reconcile returned goods with gate inward scan.'
    });
  }

  return {
    connected,
    dbStatus,
    summary: {
      totalMaterials,
      totalStockQty,
      lowStockCount: lowStockItems.length,
      categoriesCount: Object.keys(categoriesMap).length,
      locationsCount: Object.keys(locationsMap).length,
      totalWeightEntries: weightSummary?.totalEntries || 0,
      totalNetWeightKg: weightSummary?.totalNetKg || 0,
      totalVerifiedPieces: weightSummary?.totalPieces || 0,
      totalZips,
      totalDoris,
      totalTransfers: recentTransfers.length,
      totalRgps: recentRgps.length,
      totalScans: recentScans.length
    },
    categories: categoriesMap,
    locations: locationsMap,
    lowStockItems,
    weightSummary,
    recentWeights,
    recentTransfers,
    recentRgps,
    recentScans,
    solutions
  };
}

/**
 * 10. ELEGANT MARKDOWN BUILDERS FOR PULSEBOT AI
 */

export function formatWeightRecordsToMarkdown(records, lotNo = '') {
  if (!records || records.length === 0) {
    return lotNo 
      ? `*No weight verification records captured for Lot **${lotNo}** in the Accessory SQL Database.*`
      : `*No weight capture records found.*`;
  }

  let md = `### ⚖️ Accessory Weight Verification Records ${lotNo ? `(Lot ${lotNo})` : ''}\n\n`;
  md += `| Material / Code | Net Wt (kg) | Gross (kg) | Wt/Piece (g) | Pieces | Packets | Location | Status | Approval |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  records.forEach(r => {
    const matName = r.materialName || r.materialCode || 'Item';
    const code = r.materialCode ? `\`${r.materialCode}\`` : '';
    const itemCell = code ? `**${matName}** (${code})` : `**${matName}**`;
    const net = Number(r.netWeightKg || 0).toFixed(2);
    const gross = Number(r.grossWeightKg || 0).toFixed(2);
    const wtPerPc = Number(r.weightPerPieceG || 0).toFixed(1);
    const pcs = r.pieces || '-';
    const pkts = r.packets || '-';
    const loc = r.storeLocation || 'Main Store';
    const status = r.status || 'Verified';
    const approval = (r.approvalStatus || '').toLowerCase() === 'approved' ? '✅ Approved' : (r.approvalStatus || 'Pending');

    md += `| ${itemCell} | **${net} kg** | ${gross} kg | ${wtPerPc}g | **${pcs}** | ${pkts} | ${loc} | ${status} | ${approval} |\n`;
  });

  return md;
}

export function formatIssueLogsToMarkdown(logs, title = '') {
  if (!logs || logs.length === 0) {
    return title 
      ? `*Accessory SQL Database ke \`issue_logs\` table mein "${title}" ke liye koi issuance record nahi mila.*`
      : `*Accessory SQL Database ke \`issue_logs\` table mein koi issuance record nahi mila.*`;
  }

  let md = `### 📋 Verified Accessory Issuance History (Table: issue_logs)\n\n`;
  md += `* 📦 **Total Issuance Records Found:** **${logs.length} entries**\n\n`;
  md += `| # | Lot Number | Material & Qty | Issued To | Issued By | Issue Date |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  logs.forEach((l, idx) => {
    const lotDisplay = l.lotId ? `**Lot ${l.lotId}**` : '-';
    const receiver = l.receiverName 
      ? `👤 **${l.receiverName}**${l.receiverDept ? ` *(${l.receiverDept})*` : ''}` 
      : (l.receiverDept ? `*${l.receiverDept}*` : 'Floor');
    const person = l.personName ? `**${l.personName}**` : 'Floor';
    const date = l.date || '-';

    let matsText = '-';
    if (Array.isArray(l.parsedMaterials) && l.parsedMaterials.length > 0) {
      matsText = l.parsedMaterials.map(m => {
        const name = m.name || m.materialName || 'Item';
        const type = m.bomItemName ? ` (${m.bomItemName})` : '';
        const qty = m.qty !== undefined && m.qty !== null ? ` ${m.qty} ${m.unit || 'Pcs'}` : '';
        return `**${name}${type}**: \`${qty.trim() || 'Issued'}\``;
      }).join(', ');
    } else if (typeof l.materials === 'string' && l.materials.trim()) {
      try {
        const parsed = JSON.parse(l.materials);
        if (Array.isArray(parsed)) {
          matsText = parsed.map(m => {
            const name = m.name || m.materialName || 'Item';
            const type = m.bomItemName ? ` (${m.bomItemName})` : '';
            const qty = m.qty !== undefined && m.qty !== null ? ` ${m.qty} ${m.unit || 'Pcs'}` : '';
            return `**${name}${type}**: \`${qty.trim() || 'Issued'}\``;
          }).join(', ');
        } else {
          matsText = l.materials;
        }
      } catch (e) {
        matsText = l.materials;
      }
    }

    md += `| ${idx + 1} | ${lotDisplay} | ${matsText} | ${receiver} | ${person} | ${date} |\n`;
  });

  return md;
}

export function formatMaterialDetailCardToMarkdown(items, searchTerm = '', userAskedPhoto = false) {
  if (!items || items.length === 0) {
    return `*Accessory SQL Database mein "${searchTerm || 'Item'}" ke naam ya category se koi material nahi mila.*`;
  }

  // Format clean title (e.g. "Tags", "Labels", "Amiri", etc.)
  let titleName = items[0]?.category || items[0]?.brand || items[0]?.name || 'Material';
  if (searchTerm && searchTerm.length <= 25 && !/(?:detail|stock|btana|batao|kitna|total|kya|hai|dikhao|pda|mre|pass|with|photo)/i.test(searchTerm)) {
    titleName = searchTerm;
  }
  const totalStockSum = items.reduce((acc, m) => acc + (Number(m.stock) || 0), 0);
  const totalPacketsSum = items.reduce((acc, m) => acc + (Number(m.packets) || 0), 0);
  const itemsWithImages = items.filter(m => m.imageUrl && m.imageUrl.trim());

  let md = `### 🏷️ Verified Accessory Stock: **${titleName}**\n\n`;
  md += `* 📦 **Total Registered Items:** **${items.length} items**\n`;
  md += `* 🔢 **Grand Total Stock:** **${Number(totalStockSum).toLocaleString()} units** (Across **${totalPacketsSum.toLocaleString()} Packets**)\n`;
  md += `* 📄 **Official PDF Export:** [📥 Download ${titleName} Stock Report (PDF)](/api/chat/pdf/accessory-stock?category=${encodeURIComponent(titleName)}&search=${encodeURIComponent(titleName)})\n`;
  if (itemsWithImages.length > 0) {
    md += `* 📸 **Verified Photos:** **${itemsWithImages.length} High-Resolution Photos** loaded in the interactive gallery below\n\n`;
  } else {
    md += `\n`;
  }

  md += `| # | Item Name | Current Stock |\n`;
  md += `| :--- | :--- | :--- |\n`;

  const displayLimit = Math.min(items.length, 120);
  items.slice(0, displayLimit).forEach((m, idx) => {
    const isLow = Number(m.stock || 0) <= Number(m.threshold || 0);
    const stockDisplay = isLow ? `⚠️ 🔴 **${Number(m.stock || 0).toLocaleString()} ${m.unit || 'Pcs'}** (Low)` : `🟢 **${Number(m.stock || 0).toLocaleString()} ${m.unit || 'Pcs'}**`;

    md += `| ${idx + 1} | **${m.name}** | ${stockDisplay} |\n`;
  });

  if (items.length > displayLimit) {
    md += `\n*Showing top ${displayLimit} of ${items.length} total items in this category. All ${items.length} items and their verified photos are accessible in the photo gallery below.*\n\n`;
  } else {
    md += `\n`;
  }

  // Summary solution sentence
  const photoNote = itemsWithImages.length > 0 ? ' Sabhi verified photos niche photo gallery me available hain.' : '';
  md += `💡 **Quick Summary:** Aapke paas total **${Number(totalStockSum).toLocaleString()} units** available hain.${photoNote}\n`;

  return md;
}

export function formatMaterialsToMarkdown(materials, title = 'Accessory Materials & Stock Inventory') {
  if (!materials || materials.length === 0) {
    return `*No materials found matching your criteria in the Accessory SQL Database.*`;
  }

  let md = `### 🧵 ${title}\n\n`;
  md += `* 📄 **Official PDF Export:** [📥 Download Stock Report (PDF)](/api/chat/pdf/accessory-stock)\n\n`;
  md += `| # | Material Name | Current Stock |\n`;
  md += `| :--- | :--- | :--- |\n`;

  materials.slice(0, 50).forEach((m, idx) => {
    const isLow = Number(m.stock || 0) <= Number(m.threshold || 0);
    const stockDisplay = isLow ? `⚠️ 🔴 **${Number(m.stock || 0).toLocaleString()} ${m.unit || 'Pcs'}** (Low)` : `🟢 **${Number(m.stock || 0).toLocaleString()} ${m.unit || 'Pcs'}**`;

    md += `| ${idx + 1} | **${m.name || '-'}** | ${stockDisplay} |\n`;
  });

  if (materials.length > 30) {
    md += `\n*Showing top 30 of ${materials.length} total materials in inventory.*\n`;
  }

  return md;
}

export function formatLowStockToMarkdown(items) {
  if (!items || items.length === 0) {
    return `✅ **Stock Health Good:** Koi bhi accessory material low stock ya critical threshold par nahi hai.`;
  }

  let md = `### 🚨 Critical Low Stock Materials & Re-order Alerts\n\n`;
  md += `* 📄 **Official PDF Export:** [📥 Download Low Stock Report (PDF)](/api/chat/pdf/accessory-stock?lowStock=true)\n\n`;
  md += `| Code | Material Name | Current Stock | Minimum Threshold | Unit | Godown Location | Solution / Re-order Action |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  items.forEach(m => {
    const deficit = Math.max(0, (Number(m.threshold) || 0) - (Number(m.stock) || 0));
    const reorderSuggest = deficit > 0 ? `Order min **${deficit * 2 || 100} ${m.unit || 'Pcs'}**` : `Replenish buffer`;
    md += `| \`${m.id}\` | **${m.name}** | 🔴 **${m.stock}** | ${m.threshold} | ${m.unit || 'Pcs'} | ${m.location || 'Godown'} | ${reorderSuggest} |\n`;
  });

  md += `\n💡 **Action Plan:** In sabhi items ka PO turant generate karein taaki stitching aur finishing line par delay na ho.\n`;
  return md;
}

export function formatMaterialTransfersToMarkdown(transfers) {
  if (!transfers || transfers.length === 0) {
    return `*No recent godown material transfers recorded.*`;
  }

  let md = `### 🚚 Recent Warehouse / Godown Location Transfers\n\n`;
  md += `| Code | Material Name | From Location | To Location | Qty | Operator | Transferred At |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  transfers.forEach(t => {
    const dateStr = t.transferredAt ? new Date(t.transferredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';
    md += `| \`${t.materialCode}\` | **${t.materialName}** | ${t.fromLocation || '-'} | ➡️ **${t.toLocation || '-'}** | ${t.quantity} (${t.transferType || 'packet'}) | ${t.operator || 'Staff'} | ${dateStr} |\n`;
  });

  return md;
}

export function formatRgpToMarkdown(rgpList) {
  if (!rgpList || rgpList.length === 0) {
    return `*No Returnable Gate Passes (RGP) found.*`;
  }

  let md = `### 📋 Returnable Gate Passes (RGP) - External Outpasses\n\n`;
  md += `| RGP No | Vendor | Item / Purpose | Department | Expected Return | Prepared By | Auth By |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  rgpList.forEach(r => {
    const rgpNo = `\`${r.rgpNo || r.id}\``;
    const purpose = r.purpose ? `${r.rgpType || 'Trim'} (${r.purpose})` : (r.rgpType || 'Accessory');
    const returnDate = r.expectedReturnDate || 'Open';
    md += `| ${rgpNo} | **${r.vendor}** | ${purpose} | ${r.department || 'Stitching'} | **${returnDate}** | ${r.preparedBy || '-'} | ${r.authorizedBy || '-'} |\n`;
  });

  return md;
}

export function formatScansToMarkdown(scans) {
  if (!scans || scans.length === 0) {
    return `*No inward barcode scans recorded.*`;
  }

  let md = `### 🔍 Inward Barcode Scans & Gate Receiving\n\n`;
  md += `| Lot No | Material Name | Scan Type | Qty | Supplier | Inspector | Scanned At |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  scans.forEach(s => {
    const dateStr = s.scanned_at ? new Date(s.scanned_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-';
    md += `| **${s.lot_number || '-'}** | ${s.material_name || '-'} | \`${s.scan_type || 'material_in'}\` | **${s.quantity || 0}** | ${s.supplier_name || '-'} | ${s.person_name || '-'} | ${dateStr} |\n`;
  });

  return md;
}

/**
 * 11. COMPLETE ACCESSORY STORAGE OVERVIEW TO MARKDOWN
 */
export function formatAccessoryStorageOverviewToMarkdown(overview) {
  const { connected, dbStatus, summary, lowStockItems, solutions } = overview;

  let md = `### 🧰 Accessory SQL Storage & Management Intelligence Dashboard\n\n`;

  // Database Connection Badge
  md += `* 🌐 **Database:** \`${dbStatus.database}\` on \`${dbStatus.host}:${dbStatus.port}\`\n`;
  md += `* ⚡ **Live Status:** ${connected ? '🟢 **ONLINE & FULLY CONNECTED**' : '🔴 **DISCONNECTED**'}\n`;
  md += `* 📊 **Registered Materials:** **${summary.totalMaterials} Items** across **${summary.categoriesCount} Categories**\n`;
  md += `* 📦 **Total Inventory Units:** **${Number(summary.totalStockQty).toLocaleString()} Units** stored across **${summary.locationsCount} Godown Locations**\n`;
  md += `* ⚖️ **Weight Scale Records:** **${summary.totalWeightEntries} Entries** (**${summary.totalNetWeightKg} kg Net** / **${Number(summary.totalVerifiedPieces).toLocaleString()} Verified Pcs**)\n`;
  md += `* ✂️ **Trim Allocations:** **${summary.totalZips} Zip Records** • **${summary.totalDoris} Dori Records**\n`;
  md += `* 🚚 **Warehouse Movements:** **${summary.totalTransfers} Material Transfers** • **${summary.totalRgps} Returnable Gate Passes**\n\n`;
  md += `---\n\n`;

  // Solutions Section
  if (solutions && solutions.length > 0) {
    md += `### 💡 PulseBot AI Operational Solutions & Recommendations\n\n`;
    solutions.forEach((sol, i) => {
      const icon = sol.severity === 'HIGH' ? '🚨' : sol.severity === 'MEDIUM' ? '⚠️' : '✅';
      md += `#### ${icon} Solution ${i + 1}: ${sol.title}\n`;
      md += `* **Analysis:** ${sol.summary}\n`;
      md += `* **Action Required:** ${sol.action}\n\n`;
    });
    md += `---\n\n`;
  }

  // Low Stock Section if any
  if (lowStockItems && lowStockItems.length > 0) {
    md += formatLowStockToMarkdown(lowStockItems) + '\n\n';
  }

  return md;
}
