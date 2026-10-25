import { createFileRoute } from '@tanstack/react-router'
import { EchoTab } from '../EchoTab'

/** 回声房（W1 链路验证入口，保留作演示/冒烟页面） */
export const Route = createFileRoute('/echo')({
  component: EchoTab,
})
