import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, ErrorNotice, Icon, Page, c, s } from './ui';

const cardReferences = new Map<string, '1111' | '0002'>([
  ['4111111111111111', '1111'],
  ['4000000000000002', '0002'],
]);

export function AddCardForm({ saving, saveFailed, onSave, onClose }: {
  saving: boolean;
  saveFailed: boolean;
  onSave: (card: '1111' | '0002') => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [code, setCode] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [numberRejected, setNumberRejected] = useState(false);
  const [error, setError] = useState('');
  const card = cardReferences.get(number);

  function updateNumber(value: string) {
    const digits = value.replace(/\D/g, '');
    const allowed = [...cardReferences.keys()].some(example => example.startsWith(digits));
    setNumberRejected(!allowed);
    if (allowed) setNumber(digits);
  }

  function submit() {
    setError('');
    if (!card || numberRejected) return setError('Enter a complete example card number.');
    const month = Number(expiry.slice(0, 2));
    const year = 2000 + Number(expiry.slice(2));
    const now = new Date();
    if (expiry.length !== 4 || month < 1 || month > 12 || new Date(year, month) <= now) {
      return setError('Enter a valid future expiry date.');
    }
    if (!name.trim() || code.length !== 3 || !postalCode.trim()) return setError('Complete the remaining card fields.');
    onSave(card);
  }

  return <Page>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Add funds" disabled={saving} onPress={onClose} style={s.iconButton}>
        <Icon name="chevron-back" />
      </Pressable>
      <Text accessibilityRole="header" style={s.heading}>Add card</Text>
    </View>
    <View style={s.panel}>
      <View style={[s.row, s.between]}><Text style={s.label}>Enter card details</Text><Icon name="card-outline" color={c.lilac} /></View>
      <Text style={s.muted}>Use example card details only.</Text>
      <Text style={s.muted}>Name on card</Text>
      <TextInput accessibilityLabel="Name on card" value={name} onChangeText={setName} autoComplete="off" editable={!saving}
        placeholder="Full name" placeholderTextColor={c.muted} maxLength={80} style={s.input} />
      <Text style={s.muted}>Card number</Text>
      <TextInput accessibilityLabel="Card number" value={number.match(/.{1,4}/g)?.join(' ') ?? ''} onChangeText={updateNumber}
        keyboardType="number-pad" autoComplete="off" editable={!saving} maxLength={19}
        placeholder="0000 0000 0000 0000" placeholderTextColor={c.muted} style={s.input} />
      {numberRejected && <Text accessibilityRole="alert" style={s.error}>Use an example number, such as 4111 1111 1111 1111.</Text>}
      <View style={s.row}>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.muted}>Expiry date</Text>
          <TextInput accessibilityLabel="Expiry date" value={expiry.length > 2 ? expiry.slice(0, 2) + '/' + expiry.slice(2) : expiry}
            onChangeText={value => setExpiry(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" autoComplete="off"
            editable={!saving} placeholder="MM/YY" placeholderTextColor={c.muted} style={s.input} />
        </View>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.muted}>Security code</Text>
          <TextInput accessibilityLabel="Security code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 3))}
            keyboardType="number-pad" secureTextEntry autoComplete="off" editable={!saving} placeholder="CVC" placeholderTextColor={c.muted} style={s.input} />
        </View>
      </View>
      <Text style={s.muted}>Billing ZIP / postal code</Text>
      <TextInput accessibilityLabel="Billing ZIP or postal code" value={postalCode} onChangeText={setPostalCode} autoComplete="off"
        editable={!saving} maxLength={12} placeholder="ZIP / postal code" placeholderTextColor={c.muted} style={s.input} />
      {!!error && <ErrorNotice>{error}</ErrorNotice>}
      {saveFailed && <ErrorNotice>Could not save the card. Try again.</ErrorNotice>}
    </View>
    <Button label={saving ? 'Saving…' : 'Save card'} disabled={saving} onPress={submit} />
    <Button label="Cancel" tone="quiet" disabled={saving} onPress={onClose} />
  </Page>;
}
