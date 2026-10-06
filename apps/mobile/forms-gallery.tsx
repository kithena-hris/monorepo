import {
  Calendar,
  Checkbox,
  Combobox,
  DatePicker,
  Dropzone,
  CurrencyField,
  AvatarUploader,
  Field,
  FileUploader,
  FormSaveBar,
  FormSection,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  NumberField,
  PasswordField,
  PhoneField,
  PinInput,
  RadioGroup,
  Rating,
  RichTextEditor,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  RadioGroupItem,
  Slider,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TimePicker,
  Toggle,
  type UploadItem,
  ToggleGroup,
  ToggleGroupItem,
  CalendarLegend,
  FileRow,
  ChoiceButton,
  FormSections,
  ImageUploader,
  Inline,
  RadioCard,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  type UploadedImage,
} from '@reach/ui-native';
import { Bold, Mail, Smartphone } from 'lucide-react-native';
import { useState } from 'react';

const ZONES = [
  { value: 'Europe/Berlin', label: 'CET' },
  { value: 'Europe/London', label: 'GMT' },
  { value: 'Asia/Tokyo', label: 'JST' },
];

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
  const [query, setQuery] = useState('');
  const [delivery, setDelivery] = useState('email');
  const [zone, setZone] = useState('Europe/Berlin');
  const [images, setImages] = useState<readonly UploadedImage[]>([]);
  const [amount, setAmount] = useState('124050');
  const [phone, setPhone] = useState('151 2345 6789');
  const [country, setCountry] = useState('DE');
  const [team, setTeam] = useState('design');
  const [offices, setOffices] = useState<string | readonly string[] | null>(['Berlin']);
  const [start, setStart] = useState<string | null>('2026-10-14');
  const [time, setTime] = useState<string | null>('09:30');
  const [skills, setSkills] = useState<readonly string[]>(['React', 'TypeScript']);
  const [files, setFiles] = useState<readonly UploadItem[]>([]);
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
      <SearchField value={query} onValueChange={setQuery} label="Search people" />
      <Field>
        <FieldLabel>Amount</FieldLabel>
        <CurrencyField value={amount} onValueChange={setAmount} currency="EUR" />
      </Field>
      <Field>
        <FieldLabel>Mobile</FieldLabel>
        <PhoneField
          value={phone}
          onValueChange={setPhone}
          country={country}
          onCountryChange={setCountry}
        />
      </Field>
      <Rating value={stars} onChange={setStars} label="Delivery" showValue />
      <Field>
        <FieldLabel>Team</FieldLabel>
        <Select value={team} onValueChange={setTeam}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Product</SelectLabel>
              <SelectItem value="engineering">Engineering</SelectItem>
              <SelectItem value="design">Design</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="sales">Sales</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <RadioGroup value={delivery} onValueChange={setDelivery} accessibilityLabel="Payslip">
        <RadioCard value="email" icon={Mail} description="A PDF to your work address">
          By email
        </RadioCard>
        <RadioCard value="app" icon={Smartphone} description="In the app only">
          In the app
        </RadioCard>
      </RadioGroup>
      <Inline gap={2}>
        <Text tone="muted">Time zone</Text>
        <ChoiceButton
          label="Time zone"
          value={zone}
          display={ZONES.find((z) => z.value === zone)?.label ?? zone}
          options={ZONES}
          onChange={setZone}
          className="text-subhead font-semibold text-fg-muted"
        />
      </Inline>
      <Combobox
        label="Offices"
        multiple
        chips
        placeholder="Add an office"
        options={['Berlin', 'London', 'Paris', 'Madrid', 'Remote'].map((o) => ({
          value: o,
          label: o,
        }))}
        value={offices}
        onChange={setOffices}
      />
      <Calendar today="2026-10-01" selected={start} onSelect={setStart} />
      <CalendarLegend items={[{ tone: 'neutral', label: '3 Oct · Day of German Unity' }]} />
      <DatePicker label="Start date" value={start} onChange={setStart} today="2026-10-01" />
      <TimePicker label="Start" value={time} onChange={setTime} />
      {/* Reach opens no picker: the app's own goes here (expo-image-picker). */}
      <AvatarUploader name="Priya Shah" pick={() => Promise.resolve([])} onPick={() => undefined} />
      <TagsInput label="Skills" value={skills} onChange={setSkills} placeholder="Add a skill" />
      <Dropzone pick={() => Promise.resolve([])} onFiles={() => undefined} />
      <ImageUploader
        label="Office photo"
        value={images}
        onChange={setImages}
        pick={() => Promise.resolve([])}
      />
      <FormSections>
        <FormSection title="Personal" description="Shown on your profile">
          <Field>
            <FieldLabel>Preferred name</FieldLabel>
            <Input value={name} onChange={setName} />
          </Field>
        </FormSection>
      </FormSections>
      <FormSection title="Emergency contact" description="Only HR can see this">
        <FormSaveBar
          open={name !== 'Priya'}
          onSave={() => undefined}
          onDiscard={() => {
            setName('Priya');
          }}
        />
      </FormSection>
      <RichTextEditor label="Welcome note" value="<p>Welcome to the team!</p>" />
      <FileRow
        item={{
          id: 'policy',
          name: 'Leave policy 2025.pdf',
          size: 240_000,
          type: 'application/pdf',
          status: 'done',
        }}
      />
      <FileUploader value={files} onChange={setFiles} pick={() => Promise.resolve([])} />
    </Stack>
  );
}
