"use client";

import { useTranslations } from '@/lib/i18n/client'
import { useState } from "react";
import { format } from "date-fns";
import { CheckCircle2 } from "lucide-react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RequestModalRouter } from "@/components/requests/request-modal-router";

export interface NeedsActionListProps {
	needsApproval: Array<{
		request: any;
		solution: any;
		approval: any;
	}>;
}

export function NeedsActionList({ needsApproval }: NeedsActionListProps) {
	const t = useTranslations();
	const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
		null,
	);
	const [isModalOpen, setIsModalOpen] = useState(false);

	const formatCurrency = (amount: number, currency: string) => {
		return new Intl.NumberFormat("th-TH", {
			style: "currency",
			currency: currency,
		}).format(amount);
	};

	const handleReviewApprove = (requestId: string) => {
		setSelectedRequestId(requestId);
		setIsModalOpen(true);
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
					<CheckCircle2 className="h-5 w-5" />
					{t('requests.solutionsAwaitingYou')}
				</h2>
				{needsApproval.length === 0 ? (
					<Card>
						<CardContent className="py-8 text-center text-gray-500">
							{t('requests.noSolutionsAwaitingYou')}
						</CardContent>
					</Card>
				) : (
					<Card>
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('requests.requestTitle')}</TableHead>
										<TableHead>{t('requests.solutionBy')}</TableHead>
										<TableHead>{t('requests.costEstimate')}</TableHead>
										<TableHead>{t('requests.submittedDate')}</TableHead>
										<TableHead className="text-right">{t('requests.action')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{needsApproval.map(({ request, solution }) => (
										<TableRow key={solution.id}>
											<TableCell className="font-medium">
												{request.title}
											</TableCell>
											<TableCell>{solution.submittedBy?.name || "-"}</TableCell>
											<TableCell>
												{formatCurrency(
													Number(solution.costEstimate),
													solution.currency,
												)}
											</TableCell>
											<TableCell>
												{format(new Date(solution.submittedAt), "MMM d, yyyy")}
											</TableCell>
											<TableCell className="text-right">
												<Button
													size="sm"
													variant="outline"
													onClick={() => handleReviewApprove(request.id)}
												>
													{t('requests.reviewAndApprove')}
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</Card>
				)}
			</div>

			{selectedRequestId && (
				<RequestModalRouter
					requestId={selectedRequestId}
					open={isModalOpen}
					onOpenChange={setIsModalOpen}
					onActionComplete={() => {
						window.location.reload();
					}}
				/>
			)}
		</div>
	);
}
