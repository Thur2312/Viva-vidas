import { Module } from '@nestjs/common'
import { UserNotificationService } from './user-notification.service'

// STUB module
@Module({ providers: [UserNotificationService], exports: [UserNotificationService] })
export class UserNotificationsModule {}
