/**
 * The only file federation exposes (DOC-030). Each screen is `framed`: the
 * host's trail and actions join the screen's own header (`./frame.tsx`).
 */
import './styles.css';

import { DocumentView as DocumentScreen } from './document/document';
import { Campaign as CampaignScreen } from './envelopes/campaign';
import {
  Envelope as EnvelopeScreen,
  Envelopes as EnvelopesScreen,
  SendForSignature as SendScreen,
} from './envelopes/envelopes';
import { framed } from './frame';
import { Library as LibraryScreen } from './library/library';
import { PersonFile as PersonFileScreen } from './people/person-file';
import {
  AccessSettings as AccessScreen,
  AiSettings as AiScreen,
  DocumentTypes as TypesScreen,
  RetentionSettings as RetentionScreen,
} from './settings/settings';

export const Library = framed(LibraryScreen);
export const DocumentView = framed(DocumentScreen);
export const PersonFile = framed(PersonFileScreen);
export const DocumentTypes = framed(TypesScreen);
export const AccessSettings = framed(AccessScreen);
export const RetentionSettings = framed(RetentionScreen);
export const AiSettings = framed(AiScreen);
export const Envelopes = framed(EnvelopesScreen);
export const Envelope = framed(EnvelopeScreen);
export const SendForSignature = framed(SendScreen);
export const Campaign = framed(CampaignScreen);
