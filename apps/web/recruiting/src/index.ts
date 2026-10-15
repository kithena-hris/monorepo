/**
 * The only file federation exposes (REC-070). Each screen is `framed`: the
 * host's trail and actions join the screen's own header (`./frame.tsx`).
 */
import './styles.css';

import { framed } from './frame';
import { JobSetup as JobSetupScreen } from './job';
import {
  RequisitionApproval as RequisitionApprovalScreen,
  RequisitionEditor as RequisitionEditorScreen,
  Requisitions as RequisitionsScreen,
} from './requisitions';
import {
  Candidate as CandidateScreen,
  Candidates as CandidatesScreen,
  Pools as PoolsScreen,
} from './candidate';
import { Pipeline as PipelineScreen } from './pipeline';
import { Home as HomeScreen, Jobs as JobsScreen } from './home';

export const Home = framed(HomeScreen);
export const Jobs = framed(JobsScreen);
export const Pipeline = framed(PipelineScreen);
export const Candidate = framed(CandidateScreen);
export const Candidates = framed(CandidatesScreen);
export const Pools = framed(PoolsScreen);
export const Requisitions = framed(RequisitionsScreen);
export const Requisition = framed(RequisitionEditorScreen);
export const RequisitionApproval = framed(RequisitionApprovalScreen);
export const JobSetup = framed(JobSetupScreen);
