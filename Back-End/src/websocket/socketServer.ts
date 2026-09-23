import { Server } from 'socket.io';

let io: Server;

export const initSocket = (httpServer: any) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('subscribeToUpload', (uploadId: string) => {
      socket.join(uploadId);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
};

export const emitProgressUpdate = (uploadId: string, data: any) => {
  if (io) {
    io.to(uploadId).emit('uploadProgress', data);
    // Broadcast summary update for history lists
    io.emit('uploadUpdate', {
      uploadId,
      status: data.status,
      progress: data.progress,
      filename: data.filename || 'Unknown'
    });
  }
};

export const emitUploadComplete = (uploadId: string, finalData: any) => {
  if (io) {
    io.to(uploadId).emit('uploadProgress', finalData);
    io.emit('uploadUpdate', {
      uploadId,
      status: finalData.status || 'COMPLETE',
      progress: 100,
      filename: finalData.filename || 'Unknown'
    });
  }
};
