/**
 * The only file federation exposes (PRF-070). Each screen is `framed`: the
 * host's trail and actions join the screen's own header (`./frame.tsx`).
 */
import './styles.css';

import { framed } from './frame';
import { Analytics as AnalyticsScreen } from './analytics';
import { Automations as AutomationsScreen, Automation as AutomationScreen } from './automations';
import {
  Calibrations as CalibrationsScreen,
  Calibration as CalibrationScreen,
} from './calibration';
import { Cycles as CyclesScreen, Setup as SetupScreen, Overview as OverviewScreen } from './cycles';
import { Feedback as FeedbackScreen, Notes as NotesScreen } from './feedback';
import { Goals as GoalsScreen, Goal as GoalScreen } from './goals';
import { Home as HomeScreen } from './home';
import {
  Learning as LearningScreen,
  Item as ItemScreen,
  Session as SessionScreen,
} from './learning';
import {
  MyReviews as MyReviewsScreen,
  Write as WriteScreen,
  Released as ReleasedScreen,
  About as AboutScreen,
  Unlocks as UnlocksScreen,
  Nominate as NominateScreen,
} from './reviews';
import {
  Settings as SettingsScreen,
  AiLog as AiLogScreen,
  Retention as RetentionScreen,
  ConnectedTools as ConnectedToolsScreen,
} from './settings';
import {
  Templates as TemplatesScreen,
  Builder as BuilderScreen,
  Preview as PreviewScreen,
  History as HistoryScreen,
} from './templates';

export const Home = framed(HomeScreen);
export const MyReviews = framed(MyReviewsScreen);
export const Write = framed(WriteScreen);
export const Released = framed(ReleasedScreen);
export const About = framed(AboutScreen);
export const Unlocks = framed(UnlocksScreen);
export const Nominate = framed(NominateScreen);
export const Cycles = framed(CyclesScreen);
export const Setup = framed(SetupScreen);
export const Overview = framed(OverviewScreen);
export const Templates = framed(TemplatesScreen);
export const Builder = framed(BuilderScreen);
export const Preview = framed(PreviewScreen);
export const History = framed(HistoryScreen);
export const Feedback = framed(FeedbackScreen);
export const Notes = framed(NotesScreen);
export const Goals = framed(GoalsScreen);
export const Goal = framed(GoalScreen);
export const Learning = framed(LearningScreen);
export const Item = framed(ItemScreen);
export const Session = framed(SessionScreen);
export const Automations = framed(AutomationsScreen);
export const Automation = framed(AutomationScreen);
export const Calibrations = framed(CalibrationsScreen);
export const Calibration = framed(CalibrationScreen);
export const Analytics = framed(AnalyticsScreen);
export const Settings = framed(SettingsScreen);
export const AiLog = framed(AiLogScreen);
export const Retention = framed(RetentionScreen);
export const ConnectedTools = framed(ConnectedToolsScreen);
