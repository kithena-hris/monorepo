import {
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  NumberField,
  PasswordField,
  PinInput,
  RadioGroup,
  Rating,
  RadioGroupItem,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from '@reach/ui-native';
import { Bold } from 'lucide-react-native';
import { useState } from 'react';

/** Lane A's form controls, rendered by Metro on a device. */
export function FormsGallery(): React.JSX.Element {
  const [name, setName] = useState('Priya');
  const [email, setEmail] = useState('priya@reach');
  const [about, setAbout] = useState('');
  const [days, setDays] = useState<number | null>(5);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('48');
  const [summary, setSummary] = useState(true);
  const [schedule, setSchedule] = useState('monthly');
  const [notify, setNotify] = useState(true);
  const [bold, setBold] = useState(false);
  const [stars, setStars] = useState(4);
  const [band, setBand] = useState([40, 75]);
  const [range, setRange] = useState<string | undefined>('week');
  return (
    <Stack className="gap-3.5">
      <Text variant="title3">Forms</Text>
      <Field>
        <FieldLabel>Preferred name</FieldLabel>
        <Input value={name} onChange={setName} />
        <FieldDescription>This is what colleagues see.</FieldDescription>
      </Field>
      <Field invalid>
        <FieldLabel>Work email</FieldLabel>
        <Input type="email" value={email} onChange={setEmail} />
        <FieldError>Use a full address, like priya@reach.co.</FieldError>
      </Field>
      <Field optional>
        <FieldLabel>About</FieldLabel>
        <Textarea value={about} onChange={setAbout} placeholder="A line or two for your profile" />
      </Field>
      <NumberField label="Days" value={days} onChange={setDays} min={0} max={30} />
      <PasswordField
        label="New password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        showStrength
      />
      <PinInput label="Verification code" value={code} onChange={setCode} groupAfter={3} />
      <Checkbox checked={summary} onCheckedChange={setSummary}>
        Send me a weekly summary
      </Checkbox>
      <RadioGroup value={schedule} onValueChange={setSchedule} accessibilityLabel="Pay schedule">
        <RadioGroupItem value="monthly">Monthly</RadioGroupItem>
        <RadioGroupItem value="weekly" description="Paid every Friday">
          Weekly
        </RadioGroupItem>
      </RadioGroup>
      <Switch checked={notify} onCheckedChange={setNotify} description="A summary every Monday">
        Email notifications
      </Switch>
      <Toggle pressed={bold} onPressedChange={setBold} icon={Bold}>
        Bold
      </Toggle>
      <ToggleGroup
        type="single"
        value={range}
        onValueChange={setRange}
        fullWidth
        accessibilityLabel="Range"
      >
        <ToggleGroupItem value="day">Day</ToggleGroupItem>
        <ToggleGroupItem value="week">Week</ToggleGroupItem>
        <ToggleGroupItem value="month">Month</ToggleGroupItem>
      </ToggleGroup>
      <Slider
        value={band}
        onValueChange={setBand}
        label="Salary band"
        min={20}
        max={120}
        tip={(v) => `€${String(v)}k`}
      />
      <Rating value={stars} onChange={setStars} label="Delivery" showValue />
    </Stack>
  );
}
