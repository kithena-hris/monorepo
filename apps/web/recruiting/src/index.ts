/**
 * The only file federation exposes (REC-070). Each screen is `framed`: the
 * host's trail and actions join the screen's own header (`./frame.tsx`).
 */
import './styles.css';

import { framed } from './frame';
import { Pipeline as PipelineScreen } from './pipeline';
import { Home as HomeScreen, Jobs as JobsScreen } from './home';

export const Home = framed(HomeScreen);
export const Jobs = framed(JobsScreen);
export const Pipeline = framed(PipelineScreen);
