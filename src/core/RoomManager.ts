import { logger } from './Logger.js';

export interface Room {
  id: string;
  createdAt: number;
  members: Map<string, { sessionId: string; joinedAt: number; name: string }>;
  metadata: Record<string, unknown>;
}

export class RoomManager {
  private static instance: RoomManager;
  private rooms = new Map<string, Room>();
  private sessionToRoom = new Map<string, string>();

  private constructor() {}

  static getInstance(): RoomManager {
    if (!RoomManager.instance) {
      RoomManager.instance = new RoomManager();
    }
    return RoomManager.instance;
  }

  createOrJoin(roomId: string, sessionId: string, memberName?: string): Room {
    let room = this.rooms.get(roomId);
    const now = Date.now();

    if (!room) {
      room = {
        id: roomId,
        createdAt: now,
        members: new Map(),
        metadata: {},
      };
      this.rooms.set(roomId, room);
      logger.info('RoomManager', `Created room: ${roomId}`);
    }

    // Remove from previous room if any
    this.leaveRoom(sessionId);

    room.members.set(sessionId, {
      sessionId,
      joinedAt: Date.now(),
      name: memberName || `User-${sessionId.slice(0, 8)}`,
    });
    this.sessionToRoom.set(sessionId, roomId);

    logger.info('RoomManager', `Session ${sessionId} joined room: ${roomId}`);
    return room;
  }

  leaveRoom(sessionId: string): boolean {
    const roomId = this.sessionToRoom.get(sessionId);
    if (!roomId) return false;

    const room = this.rooms.get(roomId);
    if (room) {
      room.members.delete(sessionId);
      if (room.members.size === 0) {
        this.rooms.delete(roomId);
        logger.info('RoomManager', `Room ${roomId} deleted (empty)`);
      }
    }
    this.sessionToRoom.delete(sessionId);
    return true;
  }

  getRoomForSession(sessionId: string): string | undefined {
    return this.sessionToRoom.get(sessionId);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): Array<{ id: string; members: number; createdAt: number }> {
    return Array.from(this.rooms.values()).map(r => ({
      id: r.id,
      members: r.members.size,
      createdAt: r.createdAt,
    }));
  }

  getRoomMembers(roomId: string): Array<{ sessionId: string; name: string; joinedAt: number }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.members.entries()).map(([sid, m]) => ({
      sessionId: sid,
      name: m.name,
      joinedAt: m.joinedAt,
    }));
  }
}
