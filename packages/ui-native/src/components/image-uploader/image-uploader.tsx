import { Camera, FileX, ImagePlus, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useCssElement } from 'react-native-css';
import { Image, Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { Avatar } from '../avatar/avatar.tsx';
import { Button } from '../button/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../dialog/dialog.tsx';
import { checkFile, type Pick, type PickedFile, type Rejection } from '../dropzone/files.ts';
import { Icon, iconVariants, type LucideIcon } from '../icon/icon.tsx';

/**
 * Images with a preview: a tile for each and a tile that adds one. Type, size
 * and dimensions are checked as soon as the picker answers, before anything is
 * uploaded, and a refusal says exactly what was wrong and what to use instead.
 *
 * Reach opens no picker: `pick` is the app's (expo-image-picker, say), and
 * uploading is the app's too. It reports progress back through `value`.
 */

export type UploadedImage = {
  id: string;
  /** What to preview: the picker's URI, or the stored image's URL. */
  uri: string;
  name: string;
  width?: number;
  height?: number;
  /** 0–100 while it uploads; `null` or absent once done. */
  progress?: number | null;
  /** Rings the tile in danger. Say why with a message beside it. */
  invalid?: boolean;
};

export type ImageUploaderProps = {
  value: readonly UploadedImage[];
  onChange: (images: readonly UploadedImage[]) => void;
  /** Opens the app's picker. */
  pick: Pick;
  /** The uploader's name. */
  label: string;
  /** MIME types. PNG, JPG and WebP by default. */
  accept?: readonly string[];
  /** Bytes. */
  maxSize?: number;
  /** Smaller images are refused, before they are uploaded. */
  minDimensions?: { width: number; height: number };
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Why it is invalid, in danger under the tiles: the app's own refusal, from a server say. */
  error?: string | undefined;
  /** The add tile's words. */
  addLabel?: string;
  onReject?: (rejections: readonly Rejection[]) => void;
  className?: string | undefined;
};

const IMAGES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const TILE = 100;

let made = 0;
const idFor = (file: PickedFile): string => {
  made += 1;
  return `${file.name}-${String(made)}`;
};

export function ImageUploader({
  value,
  onChange,
  pick,
  label,
  accept = IMAGES,
  maxSize,
  minDimensions,
  multiple = false,
  maxFiles = multiple ? Infinity : 1,
  disabled = false,
  invalid = false,
  error,
  addLabel,
  onReject,
  className,
}: ImageUploaderProps): React.JSX.Element {
  const [refused, setRefused] = useState<readonly Rejection[]>([]);
  const room = maxFiles - value.length;

  const take = (files: readonly PickedFile[]): void => {
    const rejections: Rejection[] = [];
    const accepted: UploadedImage[] = [];
    for (const file of files) {
      const why = checkFile(file, { accept, maxSize, minDimensions });
      if (why) rejections.push(why);
      else if (accepted.length >= room)
        rejections.push({
          file,
          reason: 'count',
          message: `Only ${String(maxFiles)} ${maxFiles === 1 ? 'image' : 'images'} allowed.`,
        });
      else
        accepted.push({
          id: idFor(file),
          uri: file.uri,
          name: file.name,
          ...(file.width === undefined ? {} : { width: file.width }),
          ...(file.height === undefined ? {} : { height: file.height }),
        });
    }
    setRefused(rejections);
    if (rejections.length) onReject?.(rejections);
    if (accepted.length) onChange(multiple ? [...value, ...accepted] : accepted);
  };

  // A refused image keeps its tile, ringed, beside a tile for the one to replace it.
  const showAdd = multiple ? room > 0 : value.length === 0 || value.some((v) => v.invalid);
  const rejected = refused[0];

  return (
    <View className={cn('gap-2.5', className)} role="group" aria-label={label}>
      <View className="flex-row flex-wrap gap-2.5">
        {value.map((image) => (
          <ImageTile
            key={image.id}
            image={image}
            onRemove={
              disabled || image.progress != null
                ? undefined
                : () => {
                    onChange(value.filter((v) => v.id !== image.id));
                  }
            }
          />
        ))}
        {showAdd ? (
          <AddTile
            label={addLabel ?? (value.length ? 'Add' : multiple ? 'Add photos' : 'Add photo')}
            name={label}
            pick={pick}
            onFiles={take}
            disabled={disabled}
            invalid={invalid || Boolean(rejected && !value.length)}
            icon={rejected?.reason === 'type' || (invalid && !value.length) ? FileX : ImagePlus}
          />
        ) : null}
      </View>
      {rejected || error ? (
        <CssText
          accessibilityLiveRegion="polite"
          aria-live="polite"
          className="text-subhead leading-[1.4] text-danger-fg"
        >
          {rejected ? refused.map((r) => r.message).join(' ') : error}
        </CssText>
      ) : null}
    </View>
  );
}

/** A picked or stored image. */
function ImageTile({
  image,
  onRemove,
}: {
  image: UploadedImage;
  onRemove: (() => void) | undefined;
}): React.JSX.Element {
  const uploading = image.progress != null;
  return (
    <View
      className={cn(
        'overflow-hidden rounded-[18px] bg-surface-sunken',
        image.invalid && 'border-2 border-danger',
      )}
      style={{ width: TILE, height: TILE }}
    >
      <Image
        source={{ uri: image.uri }}
        accessibilityLabel={image.name}
        alt={image.name}
        className="absolute inset-0"
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
      />
      {uploading ? <Uploading progress={image.progress ?? 0} name={image.name} /> : null}
      {onRemove ? (
        <View className="absolute top-1.5 right-1.5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${image.name}`}
            hitSlop={10}
            onPress={onRemove}
            className="size-6 items-center justify-center rounded-full bg-overlay"
          >
            <Icon icon={X} size={13} tone="on-accent" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** The dashed tile that opens the picker. */
function AddTile({
  label,
  name,
  pick,
  onFiles,
  disabled,
  invalid,
  icon,
  size = TILE,
  round = false,
}: {
  label: string;
  name: string;
  pick: Pick;
  onFiles: (files: readonly PickedFile[]) => void;
  disabled: boolean;
  invalid: boolean;
  icon: LucideIcon;
  size?: number;
  round?: boolean;
}): React.JSX.Element {
  const ring = useFocusRing();
  const press = usePress();
  return (
    // The press on a bare Animated.View, the classes inside it (RMB-001).
    <Animated.View style={press.style}>
      <Pressable
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${label || 'Add a photo'}, ${name}`}
        accessibilityState={{ disabled }}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onPress={() => {
          void pick().then((files) => {
            if (files.length) onFiles(files);
          });
        }}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className={cn(
          'items-center justify-center gap-1 border-2 border-dashed outline-none active:bg-surface-sunken',
          round ? 'rounded-full' : 'rounded-[18px]',
          invalid ? 'border-danger' : 'border-border-strong',
          disabled && 'opacity-45',
        )}
        style={{ width: size, height: size }}
      >
        <Icon icon={icon} size={22} tone={invalid ? 'danger' : 'muted'} />
        {label ? (
          <CssText
            aria-hidden
            className={cn(
              'px-1 text-center text-[11px] leading-[1.2] font-semibold',
              invalid ? 'text-danger-fg' : 'text-fg-muted',
            )}
          >
            {label}
          </CssText>
        ) : null}
        {ring.focused ? (
          <View
            style={{ pointerEvents: 'none' }}
            className={cn(
              'absolute -inset-[5px] border-[3px] border-border-focus',
              round ? 'rounded-full' : 'rounded-[23px]',
            )}
          />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

/** The scrim and ring over an image while it uploads, read as a progress bar. */
function Uploading({ progress, name }: { progress: number; name: string }): React.JSX.Element {
  const side = 40;
  const width = 4;
  const r = (side - width) / 2;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  const ring = useCssElement(
    Svg,
    {
      width: side,
      height: side,
      viewBox: `0 0 ${String(side)} ${String(side)}`,
      fill: 'none',
      className: iconVariants({ tone: 'accent' }),
      style: { transform: [{ rotate: '-90deg' }] },
      children: [
        <Circle
          key="arc"
          cx={side / 2}
          cy={side / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${String((c * value) / 100)} ${String(c)}`}
        />,
      ],
    },
    mapping,
  );
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Uploading ${name}`}
      accessibilityValue={{ min: 0, max: 100, now: value }}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      role="progressbar"
      aria-label={`Uploading ${name}`}
      className="absolute inset-0 items-center justify-center bg-overlay"
    >
      {ring}
      <CssText
        aria-hidden
        className="absolute text-[10px] leading-none font-bold text-fg-on-accent"
      >
        {`${String(value)}%`}
      </CssText>
    </View>
  );
}

/* --------------------------------------------------------- AvatarUploader */

export type AvatarUploaderProps = {
  /** The stored or picked image, or nothing yet. */
  src?: string | null;
  /** Whose picture: the initials while there is none, and the name read for it. */
  name: string;
  /** A picked file that passed the checks. Upload it, then pass its URL back as `src`. */
  onPick: (file: PickedFile) => void;
  /** Takes the picture away. Without it there is no Remove. */
  onRemove?: () => void;
  pick: Pick;
  /** Circle for people; rounded for teams and apps. */
  shape?: 'circle' | 'rounded';
  /** 16:10 for a cover. */
  ratio?: 'square' | 'wide';
  /** Points. 96 by default. */
  size?: number;
  /** `beside`: buttons next to it. `photo`: the picture is the button, and opens the options. */
  controls?: 'beside' | 'photo';
  /** 0–100 while the new one uploads. */
  progress?: number | null;
  accept?: readonly string[];
  maxSize?: number;
  minDimensions?: { width: number; height: number };
  disabled?: boolean;
  /** Beside the picture: its file name and when it was stored, say. */
  children?: ReactNode;
  onReject?: (rejection: Rejection) => void;
  className?: string | undefined;
};

/**
 * One picture: a person's photo, a team's mark, a cover. Avatar's own shapes
 * and initials, with a camera badge that says it can be changed.
 */
export function AvatarUploader({
  src,
  name,
  onPick,
  onRemove,
  pick,
  shape = 'circle',
  ratio = 'square',
  size = 96,
  controls = 'beside',
  progress,
  accept = IMAGES,
  maxSize,
  minDimensions,
  disabled = false,
  children,
  onReject,
  className,
}: AvatarUploaderProps): React.JSX.Element {
  const [refused, setRefused] = useState<Rejection | null>(null);
  const [options, setOptions] = useState(false);
  const choose = (): void => {
    void pick().then((files) => {
      const file = files[0];
      if (!file) return;
      const why = checkFile(file, { accept, maxSize, minDimensions });
      setRefused(why);
      if (why) onReject?.(why);
      else onPick(file);
    });
  };
  const wide = ratio === 'wide';
  const width = wide ? Math.round(size * 1.6) : size;
  const round = shape === 'circle' && !wide;
  const uploading = progress != null;

  const picture = (
    <View
      className={cn('overflow-hidden', round ? 'rounded-full' : 'rounded-[18px]')}
      style={{ width, height: size }}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          accessibilityLabel={name}
          alt={name}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <Avatar
          name={name}
          size={size}
          shape={round ? 'circle' : 'rounded'}
          tone="accent"
          className={wide ? 'w-full rounded-[18px]' : undefined}
        />
      )}
      {uploading ? <Uploading progress={progress} name={name} /> : null}
    </View>
  );

  const badge = (
    <View
      aria-hidden
      className="absolute size-7 items-center justify-center rounded-full bg-surface-raised shadow-md"
      style={{ right: round ? 4 : 6, bottom: round ? 4 : 6 }}
    >
      <Icon icon={Camera} size={14} />
    </View>
  );

  const message = refused ? (
    <CssText
      accessibilityLiveRegion="polite"
      aria-live="polite"
      className="text-subhead leading-[1.4] text-danger-fg"
    >
      {refused.message}
    </CssText>
  ) : null;

  if (controls === 'photo') {
    return (
      <View className={cn('items-center gap-2.5', className)}>
        <Dialog open={options} onOpenChange={setOptions}>
          <PhotoButton
            name={name}
            round={round}
            disabled={disabled || uploading}
            onPress={() => {
              if (onRemove && src) setOptions(true);
              else choose();
            }}
          >
            {picture}
          </PhotoButton>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{`${name}’s photo`}</DialogTitle>
            </DialogHeader>
            <DialogFooter stack>
              <Button
                variant="primary"
                onPress={() => {
                  setOptions(false);
                  choose();
                }}
              >
                Choose a new photo
              </Button>
              <Button
                variant="danger-soft"
                onPress={() => {
                  setOptions(false);
                  onRemove?.();
                }}
              >
                Remove photo
              </Button>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {message}
      </View>
    );
  }

  return (
    <View className={cn('gap-2.5', className)}>
      <View className="flex-row items-center gap-5">
        <View>
          {picture}
          {!disabled && !uploading ? badge : null}
        </View>
        {children ?? (
          <View className="items-start gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || uploading}
              accessibilityLabel={src ? `Change ${name}’s photo` : `Add ${name}’s photo`}
              onPress={choose}
            >
              {src ? 'Change photo' : 'Add photo'}
            </Button>
            {onRemove && src ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || uploading}
                accessibilityLabel={`Remove ${name}’s photo`}
                onPress={onRemove}
                className="-ml-[15px]"
              >
                Remove
              </Button>
            ) : null}
          </View>
        )}
      </View>
      {message}
    </View>
  );
}

/** The picture as the control: "Change" over it while focused or pressed. */
function PhotoButton({
  name,
  round,
  disabled,
  onPress,
  children,
}: {
  name: string;
  round: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const shape = round ? 'rounded-full' : 'rounded-[18px]';
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Change ${name}’s photo`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      className={cn(shape, 'outline-none')}
    >
      {({ pressed }: { pressed: boolean }) => (
        <>
          {children}
          {pressed || ring.focused ? (
            <View
              aria-hidden
              className={cn('absolute inset-0 items-center justify-center gap-1 bg-overlay', shape)}
            >
              <Icon icon={Camera} size={22} tone="on-accent" />
              <CssText className="text-[12px] leading-none font-semibold text-fg-on-accent">
                Change
              </CssText>
            </View>
          ) : null}
          {ring.focused ? (
            <View
              style={{ pointerEvents: 'none' }}
              className={cn(
                'absolute -inset-[5px] border-[3px] border-border-focus',
                round ? 'rounded-full' : 'rounded-[23px]',
              )}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
}
