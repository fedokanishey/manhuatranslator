import translate from 'google-translate-api-x';

try {
  console.log('Testing translation...');
  const result = await translate('WHERE AM I?', { to: 'ar' });
  console.log('SUCCESS:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('TRANSLATION FAILED:', err.message);
  console.error('Full error:', err);
}
