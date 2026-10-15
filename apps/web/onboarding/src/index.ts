/**
 * The only file federation exposes (ONB-010). Each screen is `framed`: the
 * host's trail and actions join the screen's own header (`./frame.tsx`).
 */
import './styles.css';

import { framed } from './frame';
import { Home as HomeScreen, Tasks as TasksScreen } from './home';
import { Plan as PlanScreen } from './plan';
import {
  Analytics as AnalyticsScreen,
  Settings as SettingsScreen,
  Templates as TemplatesScreen,
} from './templates';

export const Home = framed(HomeScreen);
export const Tasks = framed(TasksScreen);
export const Plan = framed(PlanScreen);
export const Templates = framed(TemplatesScreen);
export const Settings = framed(SettingsScreen);
export const Analytics = framed(AnalyticsScreen);
