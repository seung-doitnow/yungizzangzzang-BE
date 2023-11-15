import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CreateOrderStreamConsumer {
  private readonly createOrderStream: Redis;

  private createRedisClient(port: number): Redis {
    const client = new Redis({ port, host: process.env.REDIS_HOST });
    client.on('error', (err) => {
      console.error(`Redis error on port ${port}:`, err);
    });
    return client;
  }

  constructor(private readonly prisma: PrismaService) {
    this.createOrderStream = this.createRedisClient(7004);
    this.consumeCreateOrderStream();
  }

  async consumeCreateOrderStream() {
    const consumerName = process.env.HOST as string;
    const groupName = 'createOrderGroup';
    const streamName = 'createOrderStream';

    while (true) {
      try {
        const messages: any = await this.createOrderStream.xreadgroup(
          'GROUP',
          groupName,
          consumerName,
          'COUNT',
          '1',
          'BLOCK',
          '1000',
          'STREAMS',
          streamName,
          '>',
        );

        if (!messages || messages.length === 0 || messages[0][1].length === 0) {
          continue;
        }

        for (const [, streamMessages] of messages) {
          for (const [messageId, messageFields] of streamMessages) {
            await this.processMessage(messageId, messageFields);
            await this.createOrderStream.xack(streamName, groupName, messageId);
          }
        }
      } catch (error) {
        console.error('스트림 처리 중 오류:', error);
      }
    }
  }

  private async processMessage(
    messageId: string,
    messageFields: any[],
  ): Promise<boolean> {
    try {
      const userIdIndex = messageFields.indexOf('userId');
      const detailsIndex = messageFields.indexOf('details');

      if (userIdIndex !== -1 && detailsIndex !== -1) {
        const userId = parseInt(messageFields[userIdIndex + 1], 10);
        const details = JSON.parse(messageFields[detailsIndex + 1]);

        await this.createOrderAndOrderItems(userId, details);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`메시지 처리 실패 - ${messageId}:`, error);
      return false;
    }
  }

  private async createOrderAndOrderItems(userId: number, details: any) {
    const { discount, storeId, totalPrice, items } = details;

    const order = await this.prisma.orders.create({
      data: {
        userId,
        storeId,
        discount,
        totalPrice,
      },
    });

    const orderItemsData = items.map((item: any) => ({
      orderId: order.orderId,
      itemId: item.itemId,
      count: item.count,
    }));

    await this.prisma.ordersItems.createMany({
      data: orderItemsData,
    });
  }
}
