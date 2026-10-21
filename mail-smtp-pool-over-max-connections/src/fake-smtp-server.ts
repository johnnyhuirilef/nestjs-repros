import net from 'node:net';

const DATA_DELAY_MS = 150;

export interface FakeSmtpServer {
  port: number;
  peakConnections: number;
  peakMessagesInFlight: number;
  resetPeaks(): void;
  close(): Promise<void>;
}

/**
 * A minimal SMTP server that counts open connections and messages in flight
 * (from MAIL FROM to the reply after DATA). With `dropFirstConnection`, the
 * first connection answers its second MAIL FROM with a 421 and closes, as a
 * server does when a pooled connection sat idle too long.
 */
export async function startFakeSmtpServer({ dropFirstConnection }: { dropFirstConnection: boolean }): Promise<FakeSmtpServer> {
  let connections = 0;
  let messagesInFlight = 0;
  let accepted = 0;
  const state = { peakConnections: 0, peakMessagesInFlight: 0 };

  const server = net.createServer((socket) => {
    const connectionNumber = ++accepted;
    let mailCommands = 0;
    let inMessage = false;
    let readingData = false;
    let buffer = '';

    connections++;
    state.peakConnections = Math.max(state.peakConnections, connections);
    // A connection stops counting once either side ends it, not when its socket is fully closed.
    let counted = true;
    const endConnection = () => {
      if (counted) {
        counted = false;
        connections--;
      }
    };
    const endMessage = () => {
      if (inMessage) {
        inMessage = false;
        messagesInFlight--;
      }
    };
    socket.on('end', endConnection);
    socket.on('close', () => {
      endConnection();
      endMessage();
    });
    socket.on('error', () => {});
    socket.write('220 fake ESMTP\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (readingData) {
        if (!buffer.endsWith('\r\n.\r\n')) return;
        buffer = '';
        readingData = false;
        // Holds each message open for a while, so messages sent at the same time overlap.
        setTimeout(() => {
          if (socket.destroyed) return;
          endMessage();
          socket.write('250 2.0.0 Ok\r\n');
        }, DATA_DELAY_MS);
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO/i.test(line)) {
          socket.write('250-fake\r\n250 8BITMIME\r\n');
        } else if (/^MAIL/i.test(line)) {
          mailCommands++;
          if (dropFirstConnection && connectionNumber === 1 && mailCommands === 2) {
            socket.end('421 4.4.2 Idle timeout, closing connection\r\n');
            endConnection();
            return;
          }
          inMessage = true;
          messagesInFlight++;
          state.peakMessagesInFlight = Math.max(state.peakMessagesInFlight, messagesInFlight);
          socket.write('250 Ok\r\n');
        } else if (/^DATA/i.test(line)) {
          readingData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.end('221 Bye\r\n');
          endConnection();
        } else {
          socket.write('250 Ok\r\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The fake SMTP server has no port.');

  return {
    port: address.port,
    get peakConnections() {
      return state.peakConnections;
    },
    get peakMessagesInFlight() {
      return state.peakMessagesInFlight;
    },
    resetPeaks() {
      state.peakConnections = connections;
      state.peakMessagesInFlight = messagesInFlight;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
