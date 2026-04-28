import { ipcMain } from 'electron';
import { TranscriptService } from '../services/TranscriptService';

export function registerTranscriptIpc(): void {
  ipcMain.handle(
    'transcript:getReasoningForFile',
    (_event, args: { taskId: string; filePath: string }) => {
      try {
        const data = TranscriptService.getReasoningForFile(args.taskId, args.filePath);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );
}
