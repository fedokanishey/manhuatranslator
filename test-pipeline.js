async function test() {
  console.log('Sending request to translation API for Chapter 1...');
  try {
    const res = await fetch('http://localhost:3000/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://www.mgeko.cc/reader/en/scoring-the-sacred-body-of-the-ancients-from-the-get-go-chapter-1-eng-li/',
        targetLang: 'ar',
      }),
    });

    console.log('Response status:', res.status);
    const json = await res.json();
    console.log('Pipeline finished, success:', json.success);
    if (json.success && json.pages) {
      console.log('Total pages in Chapter 1:', json.pages.length);
      for (const page of json.pages) {
        console.log(`Page ${page.pageIndex} overlays count: ${page.overlays?.length || 0}`);
        if (page.overlays) {
          const matches = page.overlays.filter(o => /birth|boy|elder|madam/i.test(o.originalText));
          if (matches.length > 0) {
            console.log(`  Page ${page.pageIndex} Matches:`, matches.map(m => `"${m.originalText}" -> "${m.translatedText}"`));
          }
        }
      }
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

test();
