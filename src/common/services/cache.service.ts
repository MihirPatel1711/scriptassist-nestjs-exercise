import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly MAX_CACHE_SIZE = 1000; // Limit cache to 1000 items
  private readonly CLEANUP_INTERVAL = 60000; // Cleanup every minute
  private cache: Record<string, { value: any; expiresAt: number }> = {};

  constructor() {
    // Start background cleanup
    this.startCleanup();
  }

  async set(key: string, value: any, ttlSeconds = 300): Promise<void> {
    try {
      // Validate key
      if (!key || typeof key !== 'string') {
        throw new Error('Invalid cache key');
      }

      // Check cache size limit
      if (Object.keys(this.cache).length >= this.MAX_CACHE_SIZE) {
        this.evictOldest();
      }

      const expiresAt = Date.now() + ttlSeconds * 1000;
      
      // Clone value to prevent reference issues
      const clonedValue = this.deepClone(value);
      
      this.cache[key] = {
        value: clonedValue,
        expiresAt,
      };
      
      this.logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
    } catch (error) {
      this.logger.error(`Cache SET error for key ${key}:`, error);
      throw error;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (!key || typeof key !== 'string') {
        return null;
      }

      const item = this.cache[key];
      
      if (!item) {
        return null;
      }
      
      // Check expiration
      if (item.expiresAt < Date.now()) {
        delete this.cache[key];
        return null;
      }
      
      // Return cloned value to prevent reference issues
      return this.deepClone(item.value) as T;
    } catch (error) {
      this.logger.error(`Cache GET error for key ${key}:`, error);
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      if (!key || typeof key !== 'string') {
        return false;
      }

      const exists = key in this.cache;
      
      if (exists) {
        delete this.cache[key];
        this.logger.debug(`Cache DELETE: ${key}`);
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Cache DELETE error for key ${key}:`, error);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      const size = Object.keys(this.cache).length;
      this.cache = {};
      this.logger.log(`Cache CLEAR: removed ${size} items`);
    } catch (error) {
      this.logger.error('Cache CLEAR error:', error);
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      if (!key || typeof key !== 'string') {
        return false;
      }

      const item = this.cache[key];
      
      if (!item) {
        return false;
      }
      
      if (item.expiresAt < Date.now()) {
        delete this.cache[key];
        return false;
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Cache HAS error for key ${key}:`, error);
      return false;
    }
  }

  // Get cache statistics
  getStats(): { size: number; maxSize: number; keys: string[] } {
    const keys = Object.keys(this.cache);
    return {
      size: keys.length,
      maxSize: this.MAX_CACHE_SIZE,
      keys: keys.slice(0, 10), // Show first 10 keys for debugging
    };
  }

  private startCleanup(): void {
    setInterval(() => {
      this.cleanupExpired();
    }, this.CLEANUP_INTERVAL);
  }

  private cleanupExpired(): void {
    try {
      const now = Date.now();
      const keys = Object.keys(this.cache);
      let cleaned = 0;

      for (const key of keys) {
        if (this.cache[key].expiresAt < now) {
          delete this.cache[key];
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`Cache cleanup: removed ${cleaned} expired items`);
      }
    } catch (error) {
      this.logger.error('Cache cleanup error:', error);
    }
  }

  private evictOldest(): void {
    try {
      const keys = Object.keys(this.cache);
      if (keys.length === 0) return;

      // Find oldest item (lowest expiresAt)
      let oldestKey = keys[0];
      let oldestTime = this.cache[keys[0]].expiresAt;

      for (const key of keys) {
        if (this.cache[key].expiresAt < oldestTime) {
          oldestKey = key;
          oldestTime = this.cache[key].expiresAt;
        }
      }

      delete this.cache[oldestKey];
      this.logger.debug(`Cache eviction: removed oldest key ${oldestKey}`);
    } catch (error) {
      this.logger.error('Cache eviction error:', error);
    }
  }

  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (obj instanceof Date) {
      return new Date(obj.getTime()) as T;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as T;
    }
    
    if (typeof obj === 'object') {
      const cloned = {} as T;
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }
    
    return obj;
  }
} 