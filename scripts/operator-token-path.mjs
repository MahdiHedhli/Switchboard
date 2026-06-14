import { homedir } from 'node:os';
import path from 'node:path';

export const defaultOperatorTokenFile = path.join(homedir(), '.switchboard', 'operator-token');
